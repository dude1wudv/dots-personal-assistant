import asyncio
import gc
import tempfile
import time
from pathlib import Path

import pytest

from server import app as server_app
from server.store import Store
from server import runs


@pytest.fixture
def backend(monkeypatch):
    state = tempfile.TemporaryDirectory(prefix='dots-runs-case-')
    store = Store(str(Path(state.name) / 'dots.sqlite'))
    monkeypatch.setattr(server_app, 'store', store)
    yield store
    monkeypatch.undo()
    gc.collect()
    state.cleanup()


def test_send_turn_does_not_restore_turn_id_after_completed_event(backend, monkeypatch):
    async def scenario():
        store = backend
        now = time.time()
        store.execute(
            'INSERT INTO conversations(id,title,model,effort,status,created,updated) VALUES(?,?,?,?,?,?,?)',
            ('thread-race', 'Race', 'gpt-6.1-sol', 'high', 'idle', now, now),
        )

        async def request(method, params):
            if method == 'turn/start':
                await server_app.receive_event(
                    'turn/started',
                    {'threadId': 'thread-race', 'turn': {'id': 'turn-race'}},
                    None,
                    'synthetic-turn-started',
                )
                await server_app.receive_event(
                    'turn/completed',
                    {'threadId': 'thread-race', 'turn': {'id': 'turn-race', 'status': 'completed'}},
                    None,
                    'synthetic-turn-completed',
                )
                return {'turn': {'id': 'turn-race'}}
            assert method == 'thread/read'
            return {}

        monkeypatch.setattr(server_app.runtime, 'request', request)
        await server_app.send_turn('thread-race', 'synthetic prompt', 'gpt-6.1-sol', 'high')

        conversation = store.one(
            'SELECT status,turn_id FROM conversations WHERE id=?',
            ('thread-race',),
        )
        assert conversation == {'status': 'idle', 'turn_id': None}
    asyncio.run(scenario())



def test_run_projection_binds_events_and_keeps_execution_separate_from_acceptance(backend):
    store = backend
    now = time.time()
    store.execute(
        'INSERT INTO conversations(id,title,model,effort,status,created,updated,bot_id) VALUES(?,?,?,?,?,?,?,?)',
        ('thread-receipt', 'Receipt', 'gpt-6.1-sol', 'high', 'idle', now, now, 'default'),
    )
    run_id = runs.create(store, 'thread-receipt', title='Receipt', bot_id='default')
    server_app._persist_event('turn/started', {'threadId': 'thread-receipt', 'turn': {'id': 'turn-receipt'}}, None, 'receipt-start')
    assert store.one('SELECT status,turn_id,started FROM runs WHERE id=?', (run_id,))['status'] == 'running'
    server_app._persist_event('turn/completed', {'threadId': 'thread-receipt', 'turn': {'id': 'turn-receipt', 'status': 'completed'}}, None, 'receipt-complete')
    run = runs.detail(store, run_id)
    assert run['status'] == 'completed'
    assert run['ended'] is not None
    assert len(run['events']) == 2
