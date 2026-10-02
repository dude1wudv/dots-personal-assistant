"""Owner questions pause a turn for input, never grant action permissions."""
import asyncio
import json
import secrets
import time

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Option(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    label: str = Field(min_length=1, max_length=100)
    description: str = Field(default='', max_length=300)


class Question(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    question: str = Field(min_length=1, max_length=500)
    options: list[Option] = Field(min_length=2, max_length=5)

    @model_validator(mode='after')
    def distinct_options(self):
        if len({o.label for o in self.options}) != len(self.options):
            raise ValueError('选项不能重复')
        return self


class Answer(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)
    option: int | None = Field(default=None, ge=0, strict=True)
    text: str | None = Field(default=None, min_length=1, max_length=2000)
    skip: bool = False
    client_id: str | None = Field(default=None, max_length=100)

    @model_validator(mode='after')
    def one_answer(self):
        if sum((self.option is not None, self.text is not None, self.skip)) != 1:
            raise ValueError('请选择一个选项、输入答案，或跳过')
        return self


# Futures are deliberately process-local: restart expires the persisted request.
waiters: dict[str, asyncio.Future] = {}


def migrate(db):
    db.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied REAL NOT NULL)')
    if db.execute('SELECT 1 FROM schema_migrations WHERE version=1').fetchone():
        return
    db.execute('''CREATE TABLE questions(
        id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES conversations(id),
        turn_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL,
        answer TEXT, created REAL NOT NULL, expires REAL NOT NULL)''')
    db.execute("CREATE UNIQUE INDEX questions_pending_thread ON questions(thread_id) WHERE status='pending'")
    db.execute('INSERT INTO schema_migrations VALUES(1,?)', (time.time(),))


def close_pending(db, thread_id=None):
    """Called inside the same transaction as turn termination/restart/stop."""
    where, args = (' AND thread_id=?', (thread_id,)) if thread_id else ('', ())
    db.execute("UPDATE questions SET status='expired' WHERE status='pending'" + where, args)


def pending(store):
    rows = store.rows("SELECT * FROM questions WHERE status='pending' AND expires>? ORDER BY created", (time.time(),))
    for row in rows:
        row['payload'] = json.loads(row['payload'])
    return rows


async def ask(store, body: Question):
    qid, now = 'question-' + secrets.token_hex(16), time.time()
    future = asyncio.get_running_loop().create_future()
    with store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        active = db.execute("SELECT id,turn_id FROM conversations WHERE status='running'").fetchall()
        if len(active) != 1 or not active[0]['turn_id']:
            raise HTTPException(409, '当前没有可关联的执行任务')
        thread_id, turn_id = active[0]['id'], active[0]['turn_id']
        if db.execute("SELECT 1 FROM questions WHERE thread_id=? AND status='pending'", (thread_id,)).fetchone():
            raise HTTPException(409, '请先等待上一个问题的回答')
        payload = body.model_dump()
        db.execute('INSERT INTO questions VALUES(?,?,?,?,?,?,?,?)', (qid, thread_id, turn_id, json.dumps(payload, ensure_ascii=False), 'pending', None, now, now + 1800))
        db.execute("UPDATE conversations SET status='waiting' WHERE id=?", (thread_id,))
        db.execute('INSERT INTO events(thread_id,kind,payload,created) VALUES(?,?,?,?)', (thread_id, 'dots/question/asked', json.dumps({'question_id': qid, **payload}, ensure_ascii=False), now))
    waiters[qid] = future
    try:
        # Also notice a stopped turn without depending on its cancelled tool HTTP request.
        while not future.done():
            await asyncio.wait({future}, timeout=1)
            if future.done():
                break
            row = store.one('SELECT status,expires FROM questions WHERE id=?', (qid,))
            if not row or row['status'] != 'pending' or row['expires'] <= time.time():
                return {'status': 'expired', 'message': '问题已结束或过期，不要推断主人选择或授权'}
        return future.result()
    finally:
        waiters.pop(qid, None)
        with store.connect() as db:
            db.execute("UPDATE questions SET status='expired' WHERE id=? AND status='pending'", (qid,))
            db.execute("UPDATE conversations SET status='running' WHERE id=? AND turn_id=? AND status='waiting' AND NOT EXISTS(SELECT 1 FROM approvals WHERE thread_id=? AND status IN ('pending','resolving'))", (thread_id, turn_id, thread_id))


def reply(store, qid: str, body: Answer):
    future = waiters.get(qid)
    if not future or future.done():
        raise HTTPException(409, '问题已结束或失效，请继续对话')
    with store.connect() as db:
        db.execute('BEGIN IMMEDIATE')
        row = db.execute("SELECT q.* FROM questions q JOIN conversations c ON c.id=q.thread_id WHERE q.id=? AND q.status='pending' AND q.expires>? AND c.turn_id=q.turn_id AND c.status IN ('running','waiting')", (qid, time.time())).fetchone()
        if not row:
            raise HTTPException(409, '问题已结束或失效，请继续对话')
        payload = json.loads(row['payload'])
        if body.option is not None and body.option >= len(payload['options']):
            raise HTTPException(400, '选项不存在')
        text = payload['options'][body.option]['label'] if body.option is not None else body.text
        result = {'status': 'skipped' if body.skip else 'answered', 'text': text, 'option': body.option}
        db.execute('UPDATE questions SET status=?,answer=? WHERE id=?', (result['status'], json.dumps(result, ensure_ascii=False), qid))
        now = time.time()
        db.execute('INSERT INTO events(thread_id,kind,payload,created) VALUES(?,?,?,?)', (row['thread_id'], 'dots/question/answered', json.dumps({'question_id': qid, **result, 'text': text or ''}, ensure_ascii=False), now))
        if text:
            db.execute('INSERT INTO events(thread_id,kind,payload,created) VALUES(?,?,?,?)', (row['thread_id'], 'dots/user/message', json.dumps({'text': text, 'question_id': qid, 'client_id': body.client_id}, ensure_ascii=False), now))
        db.execute("UPDATE conversations SET status='running' WHERE id=? AND status='waiting' AND NOT EXISTS(SELECT 1 FROM approvals WHERE thread_id=? AND status IN ('pending','resolving'))", (row['thread_id'], row['thread_id']))
    # Only wake the executing tool after the answer and its echo commit together.
    future.set_result(result)
    return {'ok': True}
