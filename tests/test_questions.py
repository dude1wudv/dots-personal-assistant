import asyncio
import json
import sqlite3
import tempfile
import time
from pathlib import Path

import httpx
import pytest

from server import app as server_app
from server import questions
from server.store import Store


@pytest.fixture
def backend(monkeypatch):
    state = tempfile.TemporaryDirectory(prefix='dots-questions-case-')
    store = Store(str(Path(state.name) / 'dots.sqlite'))
    monkeypatch.setattr(server_app, 'store', store)
    yield store
    questions.waiters.clear()
    monkeypatch.undo()
    state.cleanup()


def add_conversation(store, thread='thread-1', turn='turn-1', status='running'):
    now = time.time()
    store.execute(
        'INSERT INTO conversations(id,title,model,effort,status,turn_id,created,updated) VALUES(?,?,?,?,?,?,?,?)',
        (thread, 'Question test', 'gpt-6.1-sol', 'high', status, turn, now, now),
    )


def question_body():
    return questions.Question(question='选哪一个？', options=[{'label': '甲'}, {'label': '乙'}])


def test_question_answer_wakes_single_future_without_approval_or_memory_side_effect(backend):
    async def scenario():
        store = backend
        add_conversation(store)
        pending = asyncio.create_task(questions.ask(store, question_body()))
        for _ in range(100):
            rows = questions.pending(store)
            if rows:
                break
            await asyncio.sleep(0.01)
        assert len(rows) == 1
        row = rows[0]
        assert (row['thread_id'], row['turn_id']) == ('thread-1', 'turn-1')
        assert store.one('SELECT status FROM conversations WHERE id=?', ('thread-1',))['status'] == 'waiting'
        assert len(questions.waiters) == 1
        assert not store.rows('SELECT * FROM approvals')
        assert store.setting('memory') is None
        questions.reply(store, row['id'], questions.Answer(option=1))
        assert await asyncio.wait_for(pending, 1) == {'status': 'answered', 'text': '乙', 'option': 1}
        assert len(store.rows("SELECT * FROM events WHERE kind='dots/user/message'")) == 1
        assert not store.rows('SELECT * FROM approvals')
        assert store.setting('memory') is None
        assert not questions.waiters
    asyncio.run(scenario())


def test_question_text_skip_and_validation_and_single_use(backend):
    async def scenario():
        store = backend
        add_conversation(store)
        task = asyncio.create_task(questions.ask(store, question_body()))
        while not questions.pending(store):
            await asyncio.sleep(0.005)
        qid = questions.pending(store)[0]['id']
        with pytest.raises(Exception) as invalid:
            questions.reply(store, qid, questions.Answer(option=5))
        assert getattr(invalid.value, 'status_code', None) == 400
        questions.reply(store, qid, questions.Answer(text=' 自定义 ', client_id='client-1'))
        assert (await asyncio.wait_for(task, 1))['text'] == '自定义'
        with pytest.raises(Exception) as duplicate:
            questions.reply(store, qid, questions.Answer(skip=True))
        assert getattr(duplicate.value, 'status_code', None) == 409
        assert len(store.rows("SELECT * FROM events WHERE kind='dots/user/message'")) == 1
        with pytest.raises(Exception):
            questions.Answer(option=0, text='mixed')
        with pytest.raises(Exception):
            questions.Answer(text='   ')
        with pytest.raises(Exception):
            questions.Question(question='  ', options=[{'label': 'A'}, {'label': 'B'}])
    asyncio.run(scenario())
def test_skip_wakes_without_creating_user_message(backend):
    async def scenario():
        add_conversation(backend)
        task = asyncio.create_task(questions.ask(backend, question_body()))
        while not questions.pending(backend):
            await asyncio.sleep(.005)
        qid = questions.pending(backend)[0]['id']
        questions.reply(backend, qid, questions.Answer(skip=True))
        assert await asyncio.wait_for(task, 1) == {'status': 'skipped', 'text': None, 'option': None}
        assert not backend.rows("SELECT * FROM events WHERE kind='dots/user/message'")
        assert qid not in questions.waiters
    asyncio.run(scenario())


def test_expired_wrong_turn_and_missing_waiter_are_rejected(backend):
    store = backend
    add_conversation(store)
    async def scenario():
        task = asyncio.create_task(questions.ask(store, question_body()))
        while not questions.pending(store):
            await asyncio.sleep(0.005)
        qid = questions.pending(store)[0]['id']
        store.execute("UPDATE conversations SET turn_id='other-turn' WHERE id='thread-1'")
        with pytest.raises(Exception) as wrong_turn:
            questions.reply(store, qid, questions.Answer(skip=True))
        assert wrong_turn.value.status_code == 409
        store.execute("UPDATE conversations SET turn_id='turn-1' WHERE id='thread-1'")
        store.execute("UPDATE questions SET expires=? WHERE id=?", (time.time() - 1, qid))
        with pytest.raises(Exception) as expired:
            questions.reply(store, qid, questions.Answer(skip=True))
        assert expired.value.status_code == 409
        store.execute("UPDATE questions SET expires=? WHERE id=?", (time.time() + 30, qid))
        questions.waiters.pop(qid)
        with pytest.raises(Exception) as no_future:
            questions.reply(store, qid, questions.Answer(skip=True))
        assert no_future.value.status_code == 409
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    asyncio.run(scenario())


def test_agent_question_requires_agent_token_and_owner_question_api_requires_session(backend, monkeypatch):
    monkeypatch.setenv('AGENT_TOKEN', 'synthetic-agent-token')
    async def scenario():
        transport = httpx.ASGITransport(app=server_app.app)
        async with httpx.AsyncClient(transport=transport, base_url='http://test') as client:
            assert (await client.post('/agent/questions', json={'question': 'Q', 'options': [{'label': 'A'}, {'label': 'B'}]})).status_code == 401
            assert (await client.post('/api/questions/not-real/answer', json={'skip': True})).status_code == 401
            assert (await client.get('/api/questions')).status_code == 401
    asyncio.run(scenario())


def test_legacy_store_migrates_questions_idempotently_and_preserves_existing_data(tmp_path):
    path = tmp_path / 'legacy.sqlite'
    now = time.time()
    with sqlite3.connect(path) as db:
        db.executescript('''
            CREATE TABLE bots(id TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL,memory TEXT NOT NULL DEFAULT '',color TEXT NOT NULL,created REAL NOT NULL);
            CREATE TABLE conversations(id TEXT PRIMARY KEY,title TEXT NOT NULL,model TEXT NOT NULL,effort TEXT NOT NULL DEFAULT 'high',status TEXT NOT NULL DEFAULT 'idle',created REAL NOT NULL,updated REAL NOT NULL);
            CREATE TABLE events(id INTEGER PRIMARY KEY AUTOINCREMENT,source TEXT UNIQUE,thread_id TEXT,kind TEXT NOT NULL,payload TEXT NOT NULL,created REAL NOT NULL);
        ''')
        db.execute('INSERT INTO bots VALUES(?,?,?,?,?,?)', ('bot-1', 'Bot', 'Role', '', '#fff', now))
        db.execute('INSERT INTO conversations VALUES(?,?,?,?,?,?,?)', ('legacy-thread', 'Chat', 'gpt-6.1-sol', 'high', 'idle', now, now))
        db.execute('INSERT INTO events(thread_id,kind,payload,created) VALUES(?,?,?,?)', ('legacy-thread', 'legacy-event', json.dumps({'ok': True}), now))
    store = Store(str(path))
    Store(str(path))
    store = Store(str(path))
    assert store.one("SELECT name FROM bots WHERE id='bot-1'")['name'] == 'Bot'
    assert store.one("SELECT title FROM conversations WHERE id='legacy-thread'")['title'] == 'Chat'
    assert store.events(thread_id='legacy-thread')[0]['payload'] == {'ok': True}
    assert store.one('SELECT COUNT(*) AS count FROM schema_migrations WHERE version=1')['count'] == 1
    assert store.one("SELECT name FROM sqlite_master WHERE type='table' AND name='questions'")
def test_turn_completion_and_runtime_epoch_close_only_on_new_epoch(backend, monkeypatch):
    store = backend
    add_conversation(store, status='waiting')
    store.execute("INSERT INTO questions VALUES(?,?,?,?,?,?,?,?)", ('q1', 'thread-1', 'turn-1', '{}', 'pending', None, time.time(), time.time() + 60))
    server_app._persist_event('turn/completed', {'threadId': 'thread-1', 'turn': {'status': 'completed'}}, None, 'complete')
    assert store.one("SELECT status FROM questions WHERE id='q1'")['status'] == 'expired'

    store.execute("UPDATE conversations SET status='waiting',turn_id='turn-1' WHERE id='thread-1'")
    store.execute("UPDATE questions SET status='pending' WHERE id='q1'")
    server_app._persist_event('runtime/restarted', {'epoch': 'epoch-1'}, None, 'epoch-1')
    assert store.one("SELECT status FROM questions WHERE id='q1'")['status'] == 'expired'
    store.execute("UPDATE conversations SET status='waiting',turn_id='turn-1' WHERE id='thread-1'")
    store.execute("UPDATE questions SET status='pending' WHERE id='q1'")
    server_app._persist_event('runtime/restarted', {'epoch': 'epoch-1'}, None, 'epoch-1-same')
    assert store.one("SELECT status FROM questions WHERE id='q1'")['status'] == 'pending'


def test_cancelled_ask_cleans_up_question_and_waiter(backend):
    async def scenario():
        add_conversation(backend)
        task = asyncio.create_task(questions.ask(backend, question_body()))
        while not questions.pending(backend):
            await asyncio.sleep(.005)
        qid = questions.pending(backend)[0]['id']
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert qid not in questions.waiters
        assert backend.one('SELECT status FROM questions WHERE id=?', (qid,))['status'] == 'expired'
    asyncio.run(scenario())
def test_group_question_reply_is_public_with_real_speaker_and_excludes_private_thread(backend):
    from server import companions

    store = backend
    add_conversation(store)
    now = time.time()
    store.execute('INSERT INTO conversations(id,title,model,created,updated) VALUES(?,?,?,?,?)', ('thread-b', 'Other member', 'gpt-6.1-sol', now, now))
    store.execute('INSERT INTO conversations(id,title,model,created,updated) VALUES(?,?,?,?,?)', ('private-thread', 'Private', 'gpt-6.1-sol', now, now))
    store.execute('INSERT INTO groups(id,title,model,created,updated) VALUES(?,?,?,?,?)', ('group-x', 'Group', 'gpt-6.1-sol', now, now))
    store.execute('INSERT INTO group_members VALUES(?,?,?)', ('group-x', 'thread-1', 0))
    store.execute('INSERT INTO group_members VALUES(?,?,?)', ('group-x', 'thread-b', 1))

    async def scenario():
        task = asyncio.create_task(questions.ask(store, question_body()))
        while not questions.pending(store):
            await asyncio.sleep(.005)
        qid = questions.pending(store)[0]['id']
        assert questions.reply(store, qid, questions.Answer(option=1)) == {'ok': True}
        assert await task == {'status': 'answered', 'text': '乙', 'option': 1}
        store.event('dots/question/asked', {'question': 'private question marker'}, 'private-thread')
        store.event('dots/user/message', {'text': 'private answer marker', 'question_id': 'private-q'}, 'private-thread')
    asyncio.run(scenario())

    events = companions.group_events(store, 'group-x', 0)
    asked = next(row for row in events if row['kind'] == 'dots/question/asked')
    answered = next(row for row in events if row['kind'] == 'dots/question/answered')
    speaker = {'id': 'default', 'name': '绒绒', 'color': 'sage'}
    assert asked['payload']['speaker'] == speaker
    assert answered['payload']['speaker'] == speaker
    context = companions.context(store, 'group-x')
    assert '选哪一个？' in context and '乙' in context
    assert 'private question marker' not in context
    assert 'private answer marker' not in context


def test_interrupt_expires_pending_question(backend, monkeypatch):
    store = backend
    add_conversation(store, status='waiting')
    store.execute("INSERT INTO questions VALUES(?,?,?,?,?,?,?,?)", ('pending-q', 'thread-1', 'turn-1', '{}', 'pending', None, time.time(), time.time() + 60))

    async def fake_request(method, params):
        assert method == 'turn/interrupt'
        assert params == {'threadId': 'thread-1', 'turnId': 'turn-1'}
        return {'ok': True}

    monkeypatch.setattr(server_app.runtime, 'request', fake_request)
    assert asyncio.run(server_app.interrupt('thread-1', None)) == {'ok': True}
    assert store.one("SELECT status FROM questions WHERE id='pending-q'")['status'] == 'expired'


def test_runtime_browser_mcp_ask_choice_transport(monkeypatch):
    import importlib
    import sys
    from unittest.mock import AsyncMock

    monkeypatch.setenv('AGENT_TOKEN', 'synthetic-agent-token')
    sys.modules.pop('runtime.browser_mcp', None)
    module = importlib.import_module('runtime.browser_mcp')
    response = type('Response', (), {
        'raise_for_status': lambda self: None,
        'json': lambda self: {'status': 'answered', 'text': '甲', 'option': 0},
    })()
    post = AsyncMock(return_value=response)
    monkeypatch.setattr(module.httpx.AsyncClient, 'post', post)

    async def scenario():
        result = await module.ask_choice(
            '选择方向？',
            [module.ChoiceOption(label='甲', description='第一项'), module.ChoiceOption(label='乙')],
        )
        assert result == {'status': 'answered', 'text': '甲', 'option': 0}

    asyncio.run(scenario())
    post.assert_awaited_once_with(
        'http://api:8091/agent/questions',
        headers={'Authorization': 'Bearer synthetic-agent-token'},
        json={'question': '选择方向？', 'options': [{'label': '甲', 'description': '第一项'}, {'label': '乙', 'description': ''}]},
    )
