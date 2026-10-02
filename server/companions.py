"""Private companions and group projections. Runtime execution stays in app.py."""
import json
import secrets
import time

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator


class BotSpec(BaseModel):
    model_config = ConfigDict(extra='forbid')
    name: str = Field(min_length=1, max_length=30)
    role: str = Field(default='你的私人工作伙伴', min_length=1, max_length=2000)
    color: str = Field(default='sage', pattern=r'^(sage|blue|rose|violet|amber)$')

    @field_validator('name', 'role')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('内容不能为空')
        return value.strip()


class BotEdit(BotSpec):
    memory: str = Field(default='', max_length=12000)


class Template(BaseModel):
    model_config = ConfigDict(extra='forbid')
    format: str = Field(default='dots-bot-v1', pattern=r'^dots-bot-v1$')
    bot: BotSpec


class GroupSpec(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    bot_ids: list[str] = Field(min_length=2, max_length=4)
    model: str = 'gpt-6.1-sol'

    @field_validator('title')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('群聊名称不能为空')
        return value.strip()

    @field_validator('bot_ids')
    @classmethod
    def unique(cls, value):
        if len(set(value)) != len(value):
            raise ValueError('成员不能重复')
        return value


def bot(store, bot_id='default'):
    if bot_id == 'default':
        return {'id': 'default', **store.setting('profile', {'name': '绒绒', 'role': '你的私人工作伙伴'}), 'memory': store.setting('memory', ''), 'color': store.setting('default_bot_color', 'sage'), 'created': 0}
    value = store.one('SELECT * FROM bots WHERE id=?', (bot_id,))
    if not value:
        raise HTTPException(404, '伙伴不存在')
    return value


def create_bot(store, spec):
    bid = 'bot-' + secrets.token_hex(12)
    store.execute('INSERT INTO bots(id,name,role,memory,color,created) VALUES(?,?,?,?,?,?)', (bid, spec.name, spec.role, '', spec.color, time.time()))
    return bot(store, bid)


def members(store, group_id):
    return store.rows('SELECT c.*,m.position FROM group_members m JOIN conversations c ON c.id=m.thread_id WHERE m.group_id=? ORDER BY m.position', (group_id,))


def group(store, group_id):
    value = store.one('SELECT * FROM groups WHERE id=?', (group_id,))
    if value:
        value['bot_id'] = 'default'
        value['members'] = [{'thread_id': c['id'], 'bot_id': c['bot_id'], 'name': bot(store, c['bot_id'])['name'], 'status': c['status']} for c in members(store, group_id)]
    return value


def conversation_list(store):
    rows = store.rows('SELECT * FROM conversations WHERE id NOT IN (SELECT thread_id FROM group_members) ORDER BY updated DESC LIMIT 200')
    rows += [group(store, row['id']) for row in store.rows('SELECT id FROM groups ORDER BY updated DESC LIMIT 200')]
    return sorted(rows, key=lambda row: row['updated'], reverse=True)[:200]


def group_events(store, group_id, after):
    rows = store.rows('SELECT * FROM events WHERE id>? AND (thread_id=? OR thread_id IN (SELECT thread_id FROM group_members WHERE group_id=?)) ORDER BY id LIMIT 500', (after, group_id, group_id))
    speakers = {c['id']: bot(store, c['bot_id']) for c in members(store, group_id)}
    for row in rows:
        row['payload'] = json.loads(row['payload'])
        speaker = speakers.get(row['thread_id'])
        if speaker:
            # Identity is derived from the stored runtime thread, never model text.
            row['payload']['speaker'] = {'id': speaker['id'], 'name': speaker['name'], 'color': speaker['color']}
    return rows


def context(store, group_id):
    # Only completed public messages from THIS group. Never include private chats,
    # raw reasoning, approval payloads or tool output in another member's input.
    rows = store.rows("SELECT thread_id,kind,payload FROM events WHERE thread_id=? OR thread_id IN (SELECT thread_id FROM group_members WHERE group_id=?) ORDER BY id DESC LIMIT 300", (group_id, group_id))
    speakers = {c['id']: bot(store, c['bot_id'])['name'] for c in members(store, group_id)}
    lines = []
    for row in reversed(rows):
        p = json.loads(row['payload'])
        if row['kind'] == 'dots/user/message' and (row['thread_id'] == group_id or p.get('question_id')):
            lines.append('主人: ' + p.get('text', '')[:4000])
        elif row['kind'] == 'dots/question/asked':
            lines.append(speakers.get(row['thread_id'], '伙伴') + ': ' + p.get('question', '')[:500])
        elif row['kind'] == 'item/completed' and p.get('item', {}).get('type') == 'agentMessage':
            lines.append(speakers.get(row['thread_id'], '伙伴') + ': ' + p['item'].get('text', '')[:4000])
    return '\n'.join(lines)[-16000:]


def cancel_queue(store, group_id, status='interrupted'):
    with store.connect() as db:
        db.execute("UPDATE group_queue SET status='cancelled' WHERE group_id=? AND status IN ('queued','running')", (group_id,))
        db.execute('UPDATE groups SET status=?,updated=? WHERE id=?', (status, time.time(), group_id))
