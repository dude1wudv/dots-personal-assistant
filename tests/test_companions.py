import asyncio
import sqlite3
import time

import pytest
from pydantic import ValidationError

from server import app as server_app
from server import companions
from server.store import Store


@pytest.fixture
def backend(tmp_path, monkeypatch):
    store = Store(str(tmp_path / 'dots.sqlite'))
    monkeypatch.setattr(server_app, 'store', store)
    monkeypatch.setattr(server_app, 'turn_lock', asyncio.Lock())
    return store


def test_legacy_database_migrates_idempotently_without_losing_chat(tmp_path):
    path = tmp_path / 'legacy.sqlite'
    db = sqlite3.connect(path)
    db.executescript('''
      CREATE TABLE conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,model TEXT NOT NULL,effort TEXT NOT NULL DEFAULT 'high',status TEXT NOT NULL DEFAULT 'idle',turn_id TEXT,created REAL NOT NULL,updated REAL NOT NULL);
      CREATE TABLE routines(id TEXT PRIMARY KEY,title TEXT NOT NULL,prompt TEXT NOT NULL,cron TEXT NOT NULL,timezone TEXT NOT NULL,model TEXT NOT NULL,enabled INTEGER NOT NULL,next_run REAL NOT NULL,thread_id TEXT,last_error TEXT);
    ''')
    db.execute('INSERT INTO conversations(id,title,model,created,updated) VALUES(?,?,?,?,?)', ('old-thread', 'Old chat', 'gpt-6.1-sol', 1, 2))
    db.commit()
    db.close()

    Store(str(path))
    Store(str(path))

    store = Store(str(path))
    assert store.one('SELECT id,title,bot_id FROM conversations WHERE id=?', ('old-thread',)) == {'id': 'old-thread', 'title': 'Old chat', 'bot_id': 'default'}
    assert [r['name'] for r in store.rows('PRAGMA table_info(conversations)')].count('bot_id') == 1
    assert 'bot_id' in {r['name'] for r in store.rows('PRAGMA table_info(routines)')}


def test_bot_create_edit_keeps_instruction_and_memory_private(backend):
    store = backend
    one = companions.create_bot(store, companions.BotSpec(name='One', role='one rules', color='blue'))
    two = companions.create_bot(store, companions.BotSpec(name='Two', role='two rules', color='rose'))
    server_app.edit_bot(one['id'], companions.BotEdit(name='One', role='revised one', memory='private one', color='violet'), None)

    assert server_app.instruction(one['id']).find('revised one') >= 0
    assert server_app.instruction(one['id']).find('private one') >= 0
    assert 'private one' not in server_app.instruction(two['id'])
    assert companions.bot(store, two['id'])['memory'] == ''


def test_group_members_bounds_deduplication_and_ordered_creation(backend, monkeypatch):
    store = backend
    for i in range(5):
        companions.create_bot(store, companions.BotSpec(name=f'Bot{i}', color='sage'))
    ids = [r['id'] for r in store.rows('SELECT id FROM bots ORDER BY created')]
    for values in ([ids[0], ids[0]], [ids[0]], ids[:5]):
        with pytest.raises(ValidationError):
            companions.GroupSpec(title='test', bot_ids=values)
    assert companions.GroupSpec(title='two', bot_ids=ids[:2]).bot_ids == ids[:2]
    assert companions.GroupSpec(title='four', bot_ids=ids[:4]).bot_ids == ids[:4]

    calls = []
    async def fake_request(method, body):
        calls.append(body['developerInstructions'])
        return {'thread': {'id': f'thread-{len(calls)}'}}
    monkeypatch.setattr(server_app.runtime, 'request', fake_request)
    group = asyncio.run(server_app.create_group(companions.GroupSpec(title='Group', bot_ids=ids[:3]), None))
    assert [m['bot_id'] for m in group['members']] == ids[:3]
    assert len(calls) == 3
    assert all(name in instructions for name, instructions in zip(['Bot0', 'Bot1', 'Bot2'], calls))


def test_group_speaker_uses_thread_owner_and_context_excludes_private_reasoning_memory(backend):
    store = backend
    first = companions.create_bot(store, companions.BotSpec(name='Ari', color='blue'))
    second = companions.create_bot(store, companions.BotSpec(name='Bea', color='rose'))
    a, b = 'thread-a', 'thread-b'
    now = time.time()
    for thread, bot_id in ((a, first['id']), (b, second['id'])):
        store.execute('INSERT INTO conversations(id,title,model,created,updated,bot_id) VALUES(?,?,?,?,?,?)', (thread, thread, 'gpt-6.1-sol', now, now, bot_id))
    store.execute('INSERT INTO groups(id,title,model,created,updated) VALUES(?,?,?,?,?)', ('group-x', 'x', 'gpt-6.1-sol', now, now))
    store.execute('INSERT INTO group_members VALUES(?,?,?)', ('group-x', a, 0))
    store.execute('INSERT INTO group_members VALUES(?,?,?)', ('group-x', b, 1))
    store.event('item/completed', {'item': {'type': 'agentMessage', 'text': 'public A'}}, a)
    store.event('item/started', {'item': {'type': 'reasoning', 'text': 'secret inference'}}, a)
    store.event('item/completed', {'item': {'type': 'agentMessage', 'text': 'private chat'}}, 'private-thread')
    store.event('dots/user/message', {'text': 'private memory marker'}, 'private-thread')

    rows = companions.group_events(store, 'group-x', 0)
    public = next(row for row in rows if row['kind'] == 'item/completed')
    assert public['payload']['speaker'] == {'id': first['id'], 'name': 'Ari', 'color': 'blue'}
    context = companions.context(store, 'group-x')
    assert 'public A' in context
    assert 'secret inference' not in context
    assert 'private chat' not in context
    assert 'private memory marker' not in context


def test_template_is_allowlisted_and_extra_import_fields_rejected(backend):
    bot = companions.create_bot(backend, companions.BotSpec(name='Template', role='role', color='amber'))
    server_app.edit_bot(bot['id'], companions.BotEdit(name='Template', role='role', memory='secret memory', color='amber'), None)
    template = server_app.bot_template(bot['id'], None)
    assert set(template['bot']) == {'name', 'role', 'color'}
    with pytest.raises(ValidationError):
        companions.Template.model_validate({'format': 'dots-bot-v1', 'bot': {'name': 'x', 'role': 'y', 'color': 'sage', 'memory': 'private'}})
    with pytest.raises(ValidationError):
        companions.Template.model_validate({'format': 'dots-bot-v1', 'bot': {'name': 'x', 'role': 'y', 'color': 'sage'}, 'secret': 'extra'})


def test_group_queue_serializes_real_thread_calls_and_pauses_for_pending_state(backend, monkeypatch):
    store = backend
    a = companions.create_bot(store, companions.BotSpec(name='A'))
    b = companions.create_bot(store, companions.BotSpec(name='B'))
    calls = []
    async def fake_request(method, body):
        calls.append((method, body.copy()))
        if method == 'thread/start':
            return {'thread': {'id': f'thread-{sum(m == "thread/start" for m, _ in calls)}'}}
        if method == 'turn/start':
            return {'turn': {'id': 'turn-id'}}
        return {}
    monkeypatch.setattr(server_app.runtime, 'request', fake_request)
    group = asyncio.run(server_app.create_group(companions.GroupSpec(title='serial', bot_ids=[a['id'], b['id']]), None))
    client_id = 'client-group-123'
    asyncio.run(server_app.send_group(group['id'], server_app.Message(text='hello', model='gpt-6.1-sol', client_id=client_id)))
    group_message = next(event for event in companions.group_events(store, group['id'], 0) if event['kind'] == 'dots/user/message')
    assert group_message['payload']['client_id'] == client_id
    asyncio.run(server_app.group_tick())
    started = [(m, p) for m, p in calls if m == 'turn/start']
    assert [p['threadId'] for _, p in started] == [group['members'][0]['thread_id']]

    current = group['members'][0]['thread_id']
    store.execute("UPDATE conversations SET status='waiting' WHERE id=?", (current,))
    asyncio.run(server_app.group_tick())
    assert len([1 for m, _ in calls if m == 'turn/start']) == 1
    store.execute("UPDATE conversations SET status='idle' WHERE id=?", (current,))
    asyncio.run(server_app.group_tick())
    asyncio.run(server_app.group_tick())
    started = [p['threadId'] for m, p in calls if m == 'turn/start']
    assert started == [group['members'][0]['thread_id'], group['members'][1]['thread_id']]
    assert started[0] != started[1]


def test_group_failure_decline_stop_and_restart_cancel_remaining_queue(backend, monkeypatch):
    store = backend
    bot_a = companions.create_bot(store, companions.BotSpec(name='A'))
    bot_b = companions.create_bot(store, companions.BotSpec(name='B'))
    for group_id, status in (('failed-group', 'failed'), ('stopped-group', 'interrupted')):
        store.execute('INSERT INTO groups(id,title,model,status,created,updated) VALUES(?,?,?,?,?,?)', (group_id, group_id, 'gpt-6.1-sol', 'running', time.time(), time.time()))
        for position, bid in enumerate((bot_a, bot_b)):
            tid = f'{group_id}-{position}'
            store.execute('INSERT INTO conversations(id,title,model,created,updated,bot_id) VALUES(?,?,?,?,?,?)', (tid, tid, 'gpt-6.1-sol', time.time(), time.time(), bid['id']))
            store.execute('INSERT INTO group_members VALUES(?,?,?)', (group_id, tid, position))
            store.execute('INSERT INTO group_queue(group_id,thread_id,text,model,effort,attachments,status) VALUES(?,?,?,?,?,?,?)', (group_id, tid, 'x', 'gpt-6.1-sol', 'high', '[]', 'running' if position == 0 else 'queued'))
        store.execute('UPDATE conversations SET status=? WHERE id=?', (status, f'{group_id}-0'))
        asyncio.run(server_app.group_tick())
        assert store.one('SELECT status FROM group_queue WHERE group_id=? AND thread_id=?', (group_id, f'{group_id}-1'))['status'] == 'cancelled'

    # Declining a pending action pauses the queue until the runtime reports the
    # turn's failed completion; that completion must cancel, not start, member 2.
    group_id = 'declined-group'
    store.execute('INSERT INTO groups(id,title,model,status,created,updated) VALUES(?,?,?,?,?,?)', (group_id, group_id, 'gpt-6.1-sol', 'running', time.time(), time.time()))
    store.execute('INSERT INTO conversations(id,title,model,status,created,updated,bot_id) VALUES(?,?,?,?,?,?,?)', ('declined-0', 'A', 'gpt-6.1-sol', 'running', time.time(), time.time(), bot_a['id']))
    store.execute('INSERT INTO conversations(id,title,model,created,updated,bot_id) VALUES(?,?,?,?,?,?)', ('declined-1', 'B', 'gpt-6.1-sol', time.time(), time.time(), bot_b['id']))
    store.execute('INSERT INTO group_members VALUES(?,?,?)', (group_id, 'declined-0', 0))
    store.execute('INSERT INTO group_members VALUES(?,?,?)', (group_id, 'declined-1', 1))
    store.execute('INSERT INTO group_queue(group_id,thread_id,text,model,effort,attachments,status) VALUES(?,?,?,?,?,?,?)', (group_id, 'declined-0', 'x', 'gpt-6.1-sol', 'high', '[]', 'running'))
    store.execute('INSERT INTO group_queue(group_id,thread_id,text,model,effort,attachments,status) VALUES(?,?,?,?,?,?,?)', (group_id, 'declined-1', 'x', 'gpt-6.1-sol', 'high', '[]', 'queued'))
    store.execute('INSERT INTO approvals VALUES(?,?,?,?,?,?)', ('approval-decline', 'declined-0', 'item/permissions/requestApproval', '{}', 'pending', time.time()))
    resolved = []
    async def fake_resolve(aid, result):
        resolved.append((aid, result))
    monkeypatch.setattr(server_app.runtime, 'resolve', fake_resolve)
    asyncio.run(server_app.resolve_approval('approval-decline', server_app.Approval(decision='decline')))
    assert resolved == [('approval-decline', {'permissions': {}, 'scope': 'turn'})]
    assert store.one('SELECT status FROM conversations WHERE id=?', ('declined-0',))['status'] == 'running'
    await_event = server_app.receive_event('turn/completed', {'threadId': 'declined-0', 'turn': {'status': 'failed'}}, None, None)
    asyncio.run(await_event)
    asyncio.run(server_app.group_tick())
    assert store.one('SELECT status FROM group_queue WHERE group_id=? AND thread_id=?', (group_id, 'declined-1'))['status'] == 'cancelled'

    # A genuine runtime epoch change interrupts active threads and cancels queued work.
    group_id = 'restart-group'
    store.execute('INSERT INTO groups(id,title,model,status,created,updated) VALUES(?,?,?,?,?,?)', (group_id, group_id, 'gpt-6.1-sol', 'running', time.time(), time.time()))
    store.execute('INSERT INTO conversations(id,title,model,status,created,updated,bot_id) VALUES(?,?,?,?,?,?,?)', ('restart-0', 'A', 'gpt-6.1-sol', 'running', time.time(), time.time(), bot_a['id']))
    store.execute('INSERT INTO conversations(id,title,model,created,updated,bot_id) VALUES(?,?,?,?,?,?)', ('restart-1', 'B', 'gpt-6.1-sol', time.time(), time.time(), bot_b['id']))
    store.execute('INSERT INTO group_members VALUES(?,?,?)', (group_id, 'restart-0', 0))
    store.execute('INSERT INTO group_members VALUES(?,?,?)', (group_id, 'restart-1', 1))
    store.execute('INSERT INTO group_queue(group_id,thread_id,text,model,effort,attachments,status) VALUES(?,?,?,?,?,?,?)', (group_id, 'restart-0', 'x', 'gpt-6.1-sol', 'high', '[]', 'running'))
    store.execute('INSERT INTO group_queue(group_id,thread_id,text,model,effort,attachments,status) VALUES(?,?,?,?,?,?,?)', (group_id, 'restart-1', 'x', 'gpt-6.1-sol', 'high', '[]', 'queued'))
    asyncio.run(server_app.receive_event('runtime/restarted', {'epoch': 'epoch-new'}, None, None))
    calls = []
    async def forbidden_send(*args, **kwargs):
        calls.append(args)
    monkeypatch.setattr(server_app, 'send_turn', forbidden_send)
    asyncio.run(server_app.group_tick())
    assert not calls
    assert store.one('SELECT status FROM group_queue WHERE group_id=? AND thread_id=?', (group_id, 'restart-1'))['status'] == 'cancelled'
    assert store.one('SELECT status FROM conversations WHERE id=?', ('restart-0',))['status'] == 'interrupted'


def test_stopping_group_through_endpoint_cancels_pending_member_without_starting_it(backend, monkeypatch):
    store = backend
    first = companions.create_bot(store, companions.BotSpec(name='A'))
    second = companions.create_bot(store, companions.BotSpec(name='B'))
    now = time.time()
    store.execute('INSERT INTO groups(id,title,model,status,created,updated) VALUES(?,?,?,?,?,?)', ('stop-route', 'stop', 'gpt-6.1-sol', 'running', now, now))
    for pos, bot in enumerate((first, second)):
        tid = f'stop-{pos}'
        store.execute('INSERT INTO conversations(id,title,model,status,turn_id,created,updated,bot_id) VALUES(?,?,?,?,?,?,?,?)', (tid, tid, 'gpt-6.1-sol', 'running' if pos == 0 else 'idle', 'turn-active' if pos == 0 else None, now, now, bot['id']))
        store.execute('INSERT INTO group_members VALUES(?,?,?)', ('stop-route', tid, pos))
        store.execute('INSERT INTO group_queue(group_id,thread_id,text,model,effort,attachments,status) VALUES(?,?,?,?,?,?,?)', ('stop-route', tid, 'x', 'gpt-6.1-sol', 'high', '[]', 'running' if pos == 0 else 'queued'))
    calls = []
    async def request(method, payload):
        calls.append((method, payload))
        return {'ok': True}
    monkeypatch.setattr(server_app.runtime, 'request', request)

    asyncio.run(server_app.interrupt('stop-route', None))
    asyncio.run(server_app.group_tick())

    assert calls == [('turn/interrupt', {'threadId': 'stop-0', 'turnId': 'turn-active'})]
    assert store.one('SELECT status FROM group_queue WHERE group_id=? AND thread_id=?', ('stop-route', 'stop-1'))['status'] == 'cancelled'
    assert not [call for call in calls if call[0] == 'turn/start']
