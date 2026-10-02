import hashlib
import hmac
import json
import secrets
import time
from collections import defaultdict, deque
from pathlib import Path

from fastapi import HTTPException, Request


def password_hash(password: str, salt: bytes) -> str:
    return hashlib.scrypt(password.encode(), salt=salt, n=16384, r=8, p=1, dklen=32).hex()


def make_owner(username: str, password: str) -> dict:
    if not username.strip() or len(password) < 12:
        raise ValueError('用户名不能为空，密码至少12个字符')
    salt = secrets.token_bytes(16)
    return {'username': username, 'salt': salt.hex(), 'password_hash': password_hash(password, salt)}


class Auth:
    def __init__(self, store, owner_file):
        self.store = store
        self.owner_file = Path(owner_file)
        self.failures = defaultdict(deque)

    def login(self, username, password, device, ip):
        now = time.time()
        attempts = self.failures[ip]
        while attempts and attempts[0] < now - 900:
            attempts.popleft()
        if len(attempts) >= 5:
            raise HTTPException(429, '尝试过多，请15分钟后重试')
        if not self.owner_file.is_file():
            raise HTTPException(503, '唯一账号尚未安全初始化')
        owner = json.loads(self.owner_file.read_text())
        valid_password = hmac.compare_digest(password_hash(password, bytes.fromhex(owner['salt'])), owner['password_hash'])
        if not hmac.compare_digest(username.encode(), owner['username'].encode()) or not valid_password:
            attempts.append(now)
            raise HTTPException(401, '账号或密码错误')
        self.failures.pop(ip, None)
        token, sid = secrets.token_urlsafe(48), secrets.token_hex(16)
        self.store.execute('DELETE FROM sessions WHERE expires<?', (now,))
        self.store.execute('INSERT INTO sessions VALUES(?,?,?,?,?)', (sid, hashlib.sha256(token.encode()).hexdigest(), device[:100], now, now + 30 * 86400))
        return {'token': token, 'session_id': sid, 'expires': now + 30 * 86400, 'username': owner['username']}

    def check(self, request: Request):
        authorization = request.headers.get('authorization', '')
        if not authorization.startswith('Bearer '):
            raise HTTPException(401, '请登录')
        token_hash = hashlib.sha256(authorization[7:].encode()).hexdigest()
        session = self.store.one('SELECT * FROM sessions WHERE token_hash=? AND expires>?', (token_hash, time.time()))
        if not session:
            raise HTTPException(401, '登录已失效，请重新登录')
        return session
