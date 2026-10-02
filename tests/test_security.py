import asyncio
import httpx
import os
import sys
import importlib.util
from pathlib import Path
from types import SimpleNamespace


def test_codex_child_does_not_inherit_runtime_token(monkeypatch):
    monkeypatch.setenv('RUNTIME_TOKEN', 'synthetic-runtime-token')
    monkeypatch.setenv('AGENT_TOKEN', 'synthetic-agent-token')
    monkeypatch.syspath_prepend(str(Path(__file__).parents[1] / 'runtime'))
    monkeypatch.setitem(sys.modules, 'browser', SimpleNamespace(Browser=lambda *args: None))

    from runtime import app as runtime_app

    spawned = {}

    class Process:
        returncode = None

    async def create_subprocess_exec(*args, **kwargs):
        spawned.update(kwargs)
        return Process()

    async def no_op(self, *args, **kwargs):
        return None

    monkeypatch.setattr(runtime_app.asyncio, 'create_subprocess_exec', create_subprocess_exec)
    monkeypatch.setattr(runtime_app.Codex, 'read', no_op)
    monkeypatch.setattr(runtime_app.Codex, 'rpc', no_op)
    monkeypatch.setattr(runtime_app.Codex, 'send', no_op)

    asyncio.run(runtime_app.Codex().start())

    child_env = spawned.get('env', os.environ)
    assert 'RUNTIME_TOKEN' not in child_env
    assert child_env['AGENT_TOKEN'] == 'synthetic-agent-token'


def test_runtime_and_agent_routes_reject_the_other_token_and_agent_browser_requires_approval(monkeypatch):
    monkeypatch.setenv('RUNTIME_TOKEN', 'synthetic-runtime-token')
    monkeypatch.setenv('AGENT_TOKEN', 'synthetic-agent-token')
    monkeypatch.syspath_prepend(str(Path(__file__).parents[1] / 'runtime'))
    monkeypatch.setitem(sys.modules, 'browser', SimpleNamespace(Browser=lambda *args: None))
    from runtime import app as runtime_app

    calls = []

    async def mocked_action(action, arguments, require_approval=False):
        calls.append((action, arguments, require_approval))
        return {'ok': True}

    monkeypatch.setattr(runtime_app.codex, 'browser', SimpleNamespace(action=mocked_action))

    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=runtime_app.app),
            base_url='http://test',
        ) as client:
            runtime_approval = await client.post(
                '/resolve',
                headers={'Authorization': 'Bearer synthetic-agent-token'},
                json={'approval_id': 'approval-1', 'result': {}},
            )
            agent_route = await client.post(
                '/agent/browser',
                headers={'Authorization': 'Bearer synthetic-runtime-token'},
                json={'action': 'click', 'arguments': {}, 'agent': False},
            )
            approved_browser = await client.post(
                '/agent/browser',
                headers={'Authorization': 'Bearer synthetic-agent-token'},
                json={'action': 'click', 'arguments': {}, 'agent': False},
            )
        assert runtime_approval.status_code == 401
        assert agent_route.status_code == 401
        assert approved_browser.status_code == 200
        assert calls == [('click', {}, True)]
    asyncio.run(scenario())



def test_browser_navigation_requires_approval_before_start_or_goto(monkeypatch, tmp_path):
    playwright = SimpleNamespace(async_playwright=lambda: None)
    monkeypatch.setitem(sys.modules, 'playwright', SimpleNamespace(async_api=playwright))
    monkeypatch.setitem(sys.modules, 'playwright.async_api', playwright)
    browser_path = Path(__file__).parents[1] / 'runtime' / 'browser.py'
    spec = importlib.util.spec_from_file_location('isolated_runtime_browser', browser_path)
    browser_module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(browser_module)

    calls = []

    async def gate(action, arguments):
        calls.append(('gate', action, arguments))
        return False

    browser = browser_module.Browser(tmp_path, gate)

    async def start():
        calls.append(('start',))

    class Page:
        url = 'about:blank'

        async def goto(self, url, **kwargs):
            calls.append(('goto', url))

    async def snapshot():
        calls.append(('snapshot',))
        return {'url': browser.page.url}

    browser.start = start
    browser.page = Page()
    browser.snapshot = snapshot

    result = asyncio.run(browser.action(
        'navigate',
        {'url': 'https://example.com/?value=synthetic-private-content'},
        require_approval=True,
    ))

    assert calls == [('gate', 'navigate', {'url': 'https://example.com/?value=synthetic-private-content'})]
    assert result['declined'] is True
