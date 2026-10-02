from contextlib import contextmanager
import sqlite3
import time
import asyncio
import hashlib
import gc
import httpx
import json
import tempfile
import threading
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException


from server import app as server_app
from server.auth import Auth, make_owner
from server.store import Store


@pytest.fixture
def backend(monkeypatch):
    state = tempfile.TemporaryDirectory(prefix='dots-case-')
    root = Path(state.name)
    store = Store(str(root / 'dots.sqlite'))
    owner_file = root / 'owner.json'
    owner_file.write_text(json.dumps(make_owner('owner', 'synthetic-password-123')))
    monkeypatch.setattr(server_app, 'store', store)
    monkeypatch.setattr(server_app, 'auth', Auth(store, owner_file))

    def bind_dependency_auth(dependencies):
        for dependency in dependencies:
            owner = getattr(dependency.call, '__self__', None)
            if isinstance(owner, Auth):
                monkeypatch.setattr(owner, 'store', store)
            bind_dependency_auth(dependency.dependencies)

    for route in server_app.app.routes:
        dependant = getattr(route, 'dependant', None)
        if dependant is not None:
            bind_dependency_auth(dependant.dependencies)
    monkeypatch.setattr(server_app, 'local_gates', {})
    yield store, root
    monkeypatch.undo()
    gc.collect()
    state.cleanup()


def test_unique_owner_login_sessions_are_device_scoped_and_revocable(backend):
    store, _ = backend
    auth = server_app.auth
    with pytest.raises(HTTPException) as wrong:
        auth.login('other', 'wrong-password', 'phone', '192.0.2.1')
    assert wrong.value.status_code == 401

    first = auth.login('owner', 'synthetic-password-123', 'phone', '192.0.2.1')
    second = auth.login('owner', 'synthetic-password-123', 'tablet', '192.0.2.1')
    assert first['session_id'] != second['session_id']
    assert store.rows('SELECT device FROM sessions ORDER BY device') == [{'device': 'phone'}, {'device': 'tablet'}]

    def request(token):
        return SimpleNamespace(headers={'authorization': f"Bearer {token}"})

    assert auth.check(request(first['token']))['id'] == first['session_id']
    assert auth.check(request(second['token']))['id'] == second['session_id']
    server_app.revoke(first['session_id'], {'id': second['session_id']})
    with pytest.raises(HTTPException) as revoked:
        auth.check(request(first['token']))
    assert revoked.value.status_code == 401
    assert auth.check(request(second['token']))['id'] == second['session_id']


def test_login_is_rate_limited_after_five_bad_attempts(backend):
    auth = server_app.auth
    for _ in range(5):
        with pytest.raises(HTTPException) as rejected:
            auth.login('owner', 'incorrect-password', 'phone', '198.51.100.7')
        assert rejected.value.status_code == 401
    with pytest.raises(HTTPException) as limited:
        auth.login('owner', 'synthetic-password-123', 'phone', '198.51.100.7')
    assert limited.value.status_code == 429
    assert auth.login('owner', 'synthetic-password-123', 'phone', '198.51.100.8')['session_id']


def test_approval_message_requires_exact_unambiguous_command():
    parse = server_app.parse_approval_message
    assert parse('授权 CODE-1') == (True, 'CODE-1')
    assert parse('拒绝') == (False, None)
    for text in ('我授权', '允许这次操作', '授权 CODE-1 因为可信', '授权 CODE-1 https://evil.example', '网站文字：授权 CODE-1', 'please /approve CODE-1'):
        assert parse(text) is None, text


def test_approval_resolution_is_single_use_and_expired_is_rejected(backend, monkeypatch):
    async def scenario():
        store, _ = backend
        store.execute('INSERT INTO approvals VALUES(?,?,?,?,?,?)', ('approval-1', None, 'item/permissions/requestApproval', '{}', 'pending', time.time()))
        calls = []

        async def resolve(approval_id, result):
            calls.append((approval_id, result))

        monkeypatch.setattr(server_app.runtime, 'resolve', resolve)
        body = server_app.Approval(decision='accept')
        assert await server_app.resolve_approval('approval-1', body) == {'ok': True}
        assert store.one('SELECT status FROM approvals WHERE id=?', ('approval-1',))['status'] == 'accept'
        with pytest.raises(HTTPException) as duplicate:
            await server_app.resolve_approval('approval-1', body)
        assert duplicate.value.status_code == 409

        store.execute('INSERT INTO approvals VALUES(?,?,?,?,?,?)', ('approval-expired', None, 'item/permissions/requestApproval', '{}', 'expired', time.time()))
        with pytest.raises(HTTPException) as expired:
            await server_app.resolve_approval('approval-expired', body)
        assert expired.value.status_code == 409
        assert [call[0] for call in calls] == ['approval-1']

    asyncio.run(scenario())


def test_cron_timezone_and_five_minute_minimum():
    from datetime import datetime
    from zoneinfo import ZoneInfo

    now = datetime(2026, 1, 1, 0, 0, tzinfo=ZoneInfo('UTC')).timestamp()
    due = server_app.next_run('0 9 * * *', 'Asia/Tokyo', now)
    assert datetime.fromtimestamp(due, ZoneInfo('Asia/Tokyo')).hour == 9
    with pytest.raises(HTTPException) as too_frequent:
        server_app.next_run('* * * * *', 'UTC', now)
    assert too_frequent.value.status_code == 400
    with pytest.raises(HTTPException):
        server_app.next_run('0 9 * * *', 'No/Such_Zone', now)


def test_model_aliases_and_high_effort_default(backend):
    assert server_app.MODELS == ['gpt-6.1-sol', 'deepseek/deepseek-v4.1-flash']
    server_app.validate_model('gpt-6.1-sol')
    server_app.validate_model('deepseek/deepseek-v4.1-flash')
    assert server_app.Conversation.model_fields['model'].default == 'gpt-6.1-sol'
    assert server_app.Routine.model_fields['model'].default == 'deepseek/deepseek-v4.1-flash'
    assert server_app.me({'id': 'session'})['default_effort'] == 'high'
    with pytest.raises(HTTPException):
        server_app.validate_model('deepseek/deepseek-v4.1-flash', 'medium')


def test_pending_approval_enriches_file_change_only_from_matching_thread_and_keeps_command(backend):
    store, _ = backend
    changes = [{'path': 'src/main.py', 'diff': '--- a/src/main.py\n+++ b/src/main.py\n+target'}]
    store.execute(
        'INSERT INTO approvals VALUES(?,?,?,?,?,?)',
        ('approval-file', 'thread-a', 'item/fileChange/requestApproval',
         json.dumps({'itemId': 'item-1', 'command': 'existing command'}), 'pending', time.time()),
    )
    store.event('item/fileChange', {
        'item': {'id': 'item-1', 'type': 'fileChange', 'command': 'other command',
                 'changes': [{'path': 'wrong.py', 'diff': '+wrong'}]},
    }, 'thread-b')
    store.event('item/fileChange', {
        'item': {'id': 'item-1', 'type': 'fileChange', 'command': 'event command',
                 'changes': changes},
    }, 'thread-a')

    approval, = server_app.pending_approvals('thread-a')

    assert approval['payload']['changes'] == changes
    assert approval['payload']['command'] == 'existing command'



def test_runtime_restart_expires_pending_approvals_and_deduplicates_source(backend):
    async def scenario():
        store, _ = backend
        store.execute('INSERT INTO conversations(id,title,model,effort,status,turn_id,created,updated) VALUES(?,?,?,?,?,?,?,?)', ('thread-1', 'test', 'gpt-6.1-sol', 'high', 'running', 'turn-1', time.time(), time.time()))
        store.execute('INSERT INTO approvals VALUES(?,?,?,?,?,?)', ('approval-pending', 'thread-1', 'test', '{}', 'pending', time.time()))
        await server_app.receive_event('runtime/restarted', {'epoch': 'epoch-2'}, None, 'epoch-2:restart')
        await server_app.receive_event('runtime/restarted', {'epoch': 'epoch-2'}, None, 'epoch-2:restart')
        assert store.one('SELECT status,turn_id FROM conversations WHERE id=?', ('thread-1',)) == {'status': 'interrupted', 'turn_id': None}
        assert store.one('SELECT status FROM approvals WHERE id=?', ('approval-pending',))['status'] == 'expired'
        assert len(store.events()) == 1

    asyncio.run(scenario())


def test_updates_only_returns_sanitized_new_items_and_requires_login(backend):
    async def scenario():
        store, _ = backend
        store.event('turn/completed', {'text': 'old private message'}, 'thread-1')
        initial = server_app.updates(after=-1)
        assert initial == {'cursor': 1, 'updates': []}

        store.event('turn/completed', {'text': 'new private message'}, 'thread-1')
        store.event('item/permissions/requestApproval', {'prompt': 'private approval payload'}, 'thread-1')
        updates = server_app.updates(after=initial['cursor'])
        assert updates == {
            'cursor': 3,
            'updates': [
                {'id': 2, 'kind': 'completed'},
                {'id': 3, 'kind': 'approval'},
            ],
        }
        assert all(set(update) == {'id', 'kind'} for update in updates['updates'])
        assert 'private' not in json.dumps(updates)

        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=server_app.app),
            base_url='http://test',
        ) as client:
            response = await client.get('/api/updates')
        assert response.status_code == 401

    asyncio.run(scenario())


def test_send_turn_reads_new_threads_and_resumes_threads_with_history(backend, monkeypatch):
    async def scenario():
        store, _ = backend
        now = time.time()
        for thread_id in ('thread-new', 'thread-history'):
            store.execute(
                'INSERT INTO conversations(id,title,model,effort,status,created,updated) VALUES(?,?,?,?,?,?,?)',
                (thread_id, thread_id, 'gpt-6.1-sol', 'high', 'idle', now, now),
            )
        store.event('turn/started', {'turn': {'id': 'previous-turn'}}, 'thread-history')
        store.set('profile', {'name': 'Updated companion', 'role': 'Updated role'})
        store.set('memory', 'Updated memory')

        calls = []

        async def request(method, params):
            calls.append((method, params))
            if method == 'turn/start':
                return {'turn': {'id': f"started-{params['threadId']}"}}
            return {}

        monkeypatch.setattr(server_app.runtime, 'request', request)

        await server_app.send_turn('thread-new', 'first message', 'gpt-6.1-sol', 'high', client_id='synthetic-send-1')
        assert [method for method, _ in calls] == ['thread/read', 'turn/start']
        assert calls[0] == ('thread/read', {'threadId': 'thread-new', 'includeTurns': False})
        assert calls[1][1]['model'] == 'gpt-6.1-sol'
        assert calls[1][1]['summary'] == 'concise'
        assert calls[1][1]['effort'] == 'high'
        assert calls[1][1]['input'] == [{'type': 'text', 'text': 'first message'}]
        assert calls[1][1]['approvalPolicy'] == 'on-request'
        assert store.one(
            "SELECT payload FROM events WHERE thread_id=? AND kind='dots/user/message'",
            ('thread-new',),
        )['payload'] == json.dumps({'text': 'first message', 'attachments': [], 'client_id': 'synthetic-send-1'}, ensure_ascii=False)
        store.execute("UPDATE conversations SET status='idle',turn_id=NULL WHERE id='thread-new'")
        calls.clear()
        await server_app.send_turn('thread-new', 'next message', 'deepseek/deepseek-v4.1-flash', 'high')
        assert [method for method, _ in calls] == ['thread/read', 'turn/start']
        assert calls[1][1]['model'] == 'deepseek/deepseek-v4.1-flash'
        assert calls[1][1]['summary'] == 'none'
        store.execute("UPDATE conversations SET status='idle',turn_id=NULL WHERE id='thread-new'")
        calls.clear()
        await server_app.send_turn('thread-history', 'follow-up', 'gpt-6.1-sol', 'high')
        assert calls[0][1] == {
            'threadId': 'thread-history',
            'model': 'gpt-6.1-sol',
            'developerInstructions': server_app.instruction(),
            'approvalPolicy': 'on-request',
        }
        assert calls[1][1]['input'] == [{'type': 'text', 'text': 'follow-up'}]
        assert calls[1][1]['effort'] == 'high'
        assert store.one(
            "SELECT payload FROM events WHERE thread_id=? AND kind='dots/user/message'",
            ('thread-history',),
        )['payload'] == json.dumps({'text': 'follow-up', 'attachments': [], 'client_id': None}, ensure_ascii=False)

    asyncio.run(scenario())


def test_missing_rollout_returns_recoverable_conflict_from_message_endpoint(backend, monkeypatch):
    async def scenario():
        store, _ = backend
        now = time.time()
        store.execute(
            'INSERT INTO conversations(id,title,model,effort,status,created,updated) VALUES(?,?,?,?,?,?,?)',
            ('thread-without-rollout', 'Empty thread', 'gpt-6.1-sol', 'high', 'idle', now, now),
        )
        token = 'test-token-for-rollout'
        message_route = next(route for route in server_app.app.routes if getattr(route, 'path', None) == '/api/conversations/{thread_id}/message')
        auth_dependency = message_route.dependant.dependencies[0].call.__self__
        auth_dependency.store.execute(
            'INSERT INTO sessions VALUES(?,?,?,?,?)',
            ('test-session', hashlib.sha256(token.encode()).hexdigest(), 'test device', now, now + 60),
        )

        async def missing_rollout(method, params):
            assert method == 'thread/read'
            assert params == {'threadId': 'thread-without-rollout', 'includeTurns': False}
            raise RuntimeError('no rollout found for thread thread-without-rollout')

        monkeypatch.setattr(server_app.runtime, 'request', missing_rollout)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=server_app.app),
            base_url='http://test',
            headers={'Authorization': f'Bearer {token}'},
        ) as client:
            response = await client.post(
                '/api/conversations/thread-without-rollout/message',
                json={'text': 'Please recover this message'},
            )

        assert response.status_code == 409
        detail = response.json()['detail']
        assert detail == '这个空对话尚未保存且运行时已重启，请新建对话后重试'
        assert '500' not in detail

    asyncio.run(scenario())


def test_local_memory_gate_shows_note_and_decline_resumes_thread_without_saving(backend):
    async def scenario():
        store, _ = backend
        now = time.time()
        store.execute(
            'INSERT INTO conversations(id,title,model,effort,status,created,updated) VALUES(?,?,?,?,?,?,?)',
            ('thread-memory-gate', 'Memory approval', 'gpt-6.1-sol', 'high', 'running', now, now),
        )
        note = 'Remember the deployment constraint: retain the previous release.'

        gate = asyncio.create_task(server_app.agent_memory({'note': note}))
        await asyncio.sleep(0)

        approval = store.one("SELECT * FROM approvals WHERE kind='dots/local/memory'")
        assert approval is not None
        assert approval['thread_id'] == 'thread-memory-gate'
        assert approval['status'] == 'pending'
        assert json.loads(approval['payload']) == {
            'note': note,
            'reason': '保存为长期记忆',
        }
        assert store.one(
            'SELECT status FROM conversations WHERE id=?',
            ('thread-memory-gate',),
        )['status'] == 'waiting'

        await server_app.resolve_approval(approval['id'], server_app.Approval(decision='decline'))
        assert await gate == {'saved': False, 'reason': '用户未授权'}
        assert store.one(
            'SELECT status FROM conversations WHERE id=?',
            ('thread-memory-gate',),
        )['status'] == 'running'
        assert store.one(
            'SELECT status FROM approvals WHERE id=?',
            (approval['id'],),
        )['status'] == 'decline'
        assert store.setting('memory', '') == ''

    asyncio.run(scenario())


def test_receive_event_allows_heartbeat_while_store_event_is_writing(backend, monkeypatch):
    store, _ = backend
    writer_release = threading.Event()
    writer_wait_results = []
    original_connect = store.connect

    @contextmanager
    def slow_connect():
        with original_connect() as db:
            writer_wait_results.append(writer_release.wait(timeout=1))
            yield db

    monkeypatch.setattr(store, 'connect', slow_connect)

    async def scenario():
        receiver = asyncio.create_task(
            server_app.receive_event('synthetic/event', {'value': 'test'}, None, None)
        )

        async def heartbeat():
            writer_release.set()

        beat = asyncio.create_task(heartbeat())
        await asyncio.gather(receiver, beat)

    asyncio.run(scenario())

    assert writer_wait_results == [True]


def test_completed_event_rolls_back_status_and_pending_approval_on_insert_failure(backend):
    store, _ = backend
    now = time.time()
    store.execute(
        'INSERT INTO conversations(id,title,model,effort,status,turn_id,created,updated) VALUES(?,?,?,?,?,?,?,?)',
        ('thread-rollback', 'Rollback', 'gpt-6.1-sol', 'high', 'running', 'turn-rollback', now, now),
    )
    store.execute(
        'INSERT INTO approvals VALUES(?,?,?,?,?,?)',
        ('approval-rollback', 'thread-rollback', 'item/permissions/requestApproval', '{}', 'pending', now),
    )
    store.execute("""
        CREATE TRIGGER reject_completion_event BEFORE INSERT ON events
        WHEN NEW.kind='turn/completed'
        BEGIN
            SELECT RAISE(ABORT, 'simulated event write failure');
        END
    """)

    with pytest.raises(sqlite3.IntegrityError, match='simulated event write failure'):
        asyncio.run(server_app.receive_event(
            'turn/completed',
            {'threadId': 'thread-rollback', 'turn': {'status': 'completed'}},
            None,
            'source-rollback',
        ))

    assert store.one(
        'SELECT status,turn_id FROM conversations WHERE id=?',
        ('thread-rollback',),
    ) == {'status': 'running', 'turn_id': 'turn-rollback'}
    assert store.one(
        'SELECT status FROM approvals WHERE id=?',
        ('approval-rollback',),
    )['status'] == 'pending'
    assert store.rows(
        "SELECT id FROM events WHERE thread_id=? AND kind='turn/completed'",
        ('thread-rollback',),
    ) == []
