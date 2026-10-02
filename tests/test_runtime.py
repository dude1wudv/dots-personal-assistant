import asyncio
import json
import os
import tempfile
import time
from pathlib import Path

import httpx


_STATE = tempfile.TemporaryDirectory(prefix='dots-runtime-tests-')
os.environ['DOTS_STATE'] = str(Path(_STATE.name) / 'state')
os.environ['OWNER_FILE'] = str(Path(_STATE.name) / 'owner.json')
os.environ['MODEL_FILE'] = str(Path(_STATE.name) / 'model.json')

from server import app as server_app
from server.runtime import Runtime
from server.store import Store


def test_consume_detects_epoch_restart_and_deduplicates_event_sources(tmp_path, monkeypatch):
    store = Store(str(tmp_path / 'state.sqlite'))
    monkeypatch.setattr(server_app, 'store', store)
    polls = 0
    stop = asyncio.Event()
    seen = []

    async def handler(request):
        nonlocal polls
        polls += 1
        if polls == 1:
            result = {'epoch': 'epoch-a', 'events': [{'seq': 4, 'method': 'turn/started', 'params': {'threadId': 'thread'}, 'approval_id': None}]}
        else:
            result = {'epoch': 'epoch-b', 'events': [{'seq': 4, 'method': 'turn/started', 'params': {'threadId': 'thread'}, 'approval_id': None}]}
        return httpx.Response(200, json=result)

    async def callback(kind, payload, approval_id, source):
        seen.append((kind, source))
        await server_app.receive_event(kind, payload, approval_id, source)
        if kind == 'turn/started' and payload.get('threadId') == 'thread' and len([item for item in seen if item[0] == kind]) == 2:
            stop.set()

    async def scenario():
        runtime = Runtime('http://runtime.invalid', 'synthetic-token')
        runtime.client = httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url='http://runtime.invalid')
        try:
            await runtime.consume(callback, stop)
        finally:
            await runtime.client.aclose()

    asyncio.run(scenario())
    assert seen == [
        ('runtime/restarted', None),
        ('turn/started', 'epoch-a:4'),
        ('runtime/restarted', None),
        ('turn/started', 'epoch-b:4'),
    ]
    assert [row['source'] for row in store.events() if row['source'] is not None] == ['epoch-a:4', 'epoch-b:4']
    assert store.setting('runtime_epoch') == 'epoch-b'


def test_restart_recovers_pending_state_without_codex_connection(tmp_path, monkeypatch):
    store = Store(str(tmp_path / 'state.sqlite'))
    monkeypatch.setattr(server_app, 'store', store)
    store.execute('INSERT INTO conversations(id,title,model,effort,status,turn_id,created,updated) VALUES(?,?,?,?,?,?,?,?)', ('thread', 'task', 'gpt-6.1-sol', 'high', 'waiting', 'turn', time.time(), time.time()))
    store.execute('INSERT INTO approvals VALUES(?,?,?,?,?,?)', ('approval', 'thread', 'permission', '{}', 'pending', time.time()))

    asyncio.run(server_app.receive_event('runtime/restarted', {'epoch': 'new-epoch'}, None, None))

    assert store.one('SELECT status,turn_id FROM conversations WHERE id=?', ('thread',)) == {'status': 'interrupted', 'turn_id': None}
    assert store.one('SELECT status FROM approvals WHERE id=?', ('approval',))['status'] == 'expired'
    assert store.setting('runtime_epoch') == 'new-epoch'
