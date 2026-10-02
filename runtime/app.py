import asyncio
import base64
import contextlib
import json
import os
import secrets
import time
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from browser import Browser

WORKSPACE = Path(os.environ.get('WORKSPACE', '/workspace')).resolve()
TOKEN = os.environ['RUNTIME_TOKEN']
ALLOWED_RPC = {
    'thread/start', 'thread/resume', 'thread/read', 'thread/list', 'thread/archive',
    'thread/compact/start', 'turn/start', 'turn/steer', 'turn/interrupt',
    'skills/list', 'mcpServerStatus/list', 'model/list', 'thread/goal/set', 'thread/goal/get', 'thread/goal/clear',
}


class Codex:
    def __init__(self):
        self.process = None
        self.reader = None
        self.waiters = {}
        self.pending = {}
        self.seq = 0
        self.epoch = secrets.token_hex(12)
        self.events = deque(maxlen=20000)
        self.counter = 0
        self.lock = asyncio.Lock()
        self.browser = Browser(WORKSPACE, self.gate)

    async def start(self):
        WORKSPACE.mkdir(parents=True, exist_ok=True)
        child_env = {key: value for key, value in os.environ.items() if key != 'RUNTIME_TOKEN'}
        identity = {'user': 10003, 'group': 10002, 'extra_groups': []} if os.name == 'posix' else {}
        self.process = await asyncio.create_subprocess_exec('codex', 'app-server', '--listen', 'stdio://', stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL, cwd=str(WORKSPACE), env=child_env, limit=8 * 1024 * 1024, **identity)
        if os.name == 'posix':
            os.setgroups([])
            os.setgid(10002)
            os.setuid(10002)
        self.reader = asyncio.create_task(self.read())
        await self.rpc('initialize', {'clientInfo': {'name': 'microedulab_dots', 'title': '绒点', 'version': '0.1.0'}, 'capabilities': {'experimentalApi': True}})
        await self.send({'method': 'initialized', 'params': {}})

    def emit(self, method, params, approval_id=None):
        self.seq += 1
        self.events.append({'seq': self.seq, 'method': method, 'params': params, 'approval_id': approval_id})

    async def send(self, message):
        if not self.process or self.process.returncode is not None:
            raise RuntimeError('Codex 运行时已停止')
        async with self.lock:
            self.process.stdin.write((json.dumps(message, ensure_ascii=False) + '\n').encode())
            await self.process.stdin.drain()

    async def rpc(self, method, params):
        self.counter += 1
        rid = f'dots-{self.counter}'
        future = asyncio.get_running_loop().create_future()
        self.waiters[rid] = future
        try:
            await self.send({'id': rid, 'method': method, 'params': params})
            return await asyncio.wait_for(future, timeout=75)
        finally:
            self.waiters.pop(rid, None)

    async def read(self):
        try:
            while line := await self.process.stdout.readline():
                message = json.loads(line)
                if 'method' not in message:
                    future = self.waiters.get(message.get('id'))
                    if future and not future.done():
                        future.set_result(message)
                    continue
                approval_id = None
                if 'id' in message:
                    approval_id = f"{self.epoch}:{message['id']}"
                    self.pending[approval_id] = {'request': message, 'created': time.time()}
                self.emit(message['method'], message.get('params', {}), approval_id)
        except (OSError, ValueError, asyncio.LimitOverrunError):
            self.emit('runtime/error', {'message': 'Codex 输出异常，运行时需重启'})
        finally:
            for future in self.waiters.values():
                if not future.done():
                    future.set_exception(RuntimeError('Codex 连接已关闭'))
            for pending in self.pending.values():
                future = pending.get('future')
                if future and not future.done():
                    future.set_result(False)
            self.emit('runtime/stopped', {'message': 'Codex 连接已关闭'})

    async def gate(self, action, arguments):
        approval_id = f'{self.epoch}:browser-{secrets.token_hex(8)}'
        future = asyncio.get_running_loop().create_future()
        self.pending[approval_id] = {'future': future, 'created': time.time()}
        self.emit('dots/action/requestApproval', {'action': action, 'arguments': arguments, 'reason': '浏览器或外部动作需要你的授权'}, approval_id)
        try:
            return await asyncio.wait_for(future, timeout=1800)
        except TimeoutError:
            return False
        finally:
            self.pending.pop(approval_id, None)
            self.emit('dots/approval/resolved', {'approvalId': approval_id})

    async def resolve(self, approval_id, result):
        pending = self.pending.pop(approval_id, None)
        if not pending:
            raise HTTPException(409, '授权已处理、过期或运行时已重启')
        if 'future' in pending:
            pending['future'].set_result(result.get('decision') == 'accept')
        else:
            await self.send({'id': pending['request']['id'], 'result': result})
        self.emit('dots/approval/resolved', {'approvalId': approval_id})
        return {'ok': True}

    async def close(self):
        await self.browser.close()
        if self.process and self.process.returncode is None:
            self.process.terminate()
            with contextlib.suppress(TimeoutError):
                await asyncio.wait_for(self.process.wait(), 10)
            if self.process.returncode is None:
                self.process.kill()
        if self.reader:
            self.reader.cancel()


codex = Codex()


@asynccontextmanager
async def lifespan(app):
    await codex.start()
    try:
        yield
    finally:
        await codex.close()


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


def authorized(request: Request):
    if not secrets.compare_digest(request.headers.get('authorization', ''), f'Bearer {TOKEN}'):
        raise HTTPException(401, 'Unauthorized')


class Rpc(BaseModel):
    method: str
    params: dict = Field(default_factory=dict)


class Resolution(BaseModel):
    approval_id: str
    result: dict


class Action(BaseModel):
    action: str
    arguments: dict = Field(default_factory=dict)
    agent: bool = False


def workspace_path(path):
    candidate = (WORKSPACE / path).resolve()
    if candidate != WORKSPACE and WORKSPACE not in candidate.parents:
        raise HTTPException(400, '路径必须在隔离工作区内')
    return candidate


@app.get('/health')
def health():
    return {'ok': codex.process is not None and codex.process.returncode is None, 'epoch': codex.epoch}


@app.post('/rpc', dependencies=[Depends(authorized)])
async def rpc(body: Rpc):
    if body.method not in ALLOWED_RPC:
        raise HTTPException(403, '不允许的运行时操作')
    try:
        return await codex.rpc(body.method, body.params)
    except (RuntimeError, TimeoutError):
        raise HTTPException(503, 'Codex 运行时暂不可用') from None


@app.get('/events', dependencies=[Depends(authorized)])
def events(after: int = 0, epoch: str = ''):
    if epoch != codex.epoch:
        after = 0
    return {'epoch': codex.epoch, 'events': [event for event in codex.events if event['seq'] > after][:500]}


@app.post('/resolve', dependencies=[Depends(authorized)])
async def resolve(body: Resolution):
    return await codex.resolve(body.approval_id, body.result)


@app.post('/browser', dependencies=[Depends(authorized)])
async def browser(body: Action):
    return await codex.browser.action(body.action, body.arguments, require_approval=body.agent)


def agent_authorized(request: Request):
    token = os.environ.get('AGENT_TOKEN', '')
    if not token or not secrets.compare_digest(request.headers.get('authorization', ''), f'Bearer {token}'):
        raise HTTPException(401, 'Unauthorized')


@app.post('/agent/browser', dependencies=[Depends(agent_authorized)])
async def agent_browser(body: Action):
    return await codex.browser.action(body.action, body.arguments, require_approval=True)


@app.get('/files', dependencies=[Depends(authorized)])
def files(path: str = ''):
    folder = workspace_path(path)
    if not folder.is_dir():
        raise HTTPException(404, '目录不存在')
    items = []
    for entry in sorted(folder.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        if entry.is_symlink() or entry.name.startswith('.'):
            continue
        items.append({'name': entry.name, 'path': str(entry.relative_to(WORKSPACE)), 'directory': entry.is_dir(), 'size': entry.stat().st_size, 'updated': entry.stat().st_mtime})
    return {'path': path, 'items': items[:1000]}


@app.get('/file', dependencies=[Depends(authorized)])
def download(path: str):
    file = workspace_path(path)
    if not file.is_file() or file.stat().st_size > 32 * 1024 * 1024:
        raise HTTPException(404, '文件不存在或超过下载上限')
    return FileResponse(file, filename=file.name, media_type='application/octet-stream')


@app.post('/file', dependencies=[Depends(authorized)])
async def upload(file: UploadFile = File(...)):
    name = Path(file.filename or 'attachment').name
    folder = workspace_path('attachments')
    folder.mkdir(exist_ok=True)
    path = folder / f'{secrets.token_hex(4)}-{name}'
    size = 0
    try:
        with path.open('xb') as output:
            while chunk := await file.read(65536):
                size += len(chunk)
                if size > 20 * 1024 * 1024:
                    raise HTTPException(413, '附件最大20MB')
                output.write(chunk)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return {'path': str(path.relative_to(WORKSPACE)), 'name': name, 'size': size}
