import argparse
import hashlib
import json
import os
import secrets
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('input', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
lines = args.input.read_text(encoding='utf-8-sig').splitlines()
if len(lines) != 2 or not lines[0] or len(lines[1]) < 12:
    raise SystemExit('凭据文件必须恰好两行，密码至少12字符；未输出内容')
if args.output.exists():
    raise SystemExit('唯一账号已存在，不覆盖；如需改密码请显式执行独立维护流程')
salt = secrets.token_bytes(16)
record = {'username': lines[0], 'salt': salt.hex(), 'password_hash': hashlib.scrypt(lines[1].encode(), salt=salt, n=16384, r=8, p=1, dklen=32).hex()}
args.output.parent.mkdir(parents=True, exist_ok=True)
fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    json.dump(record, out)
os.chown(args.output, 10001, 10001)
args.input.unlink()
print('唯一账号已初始化为加盐scrypt摘要，服务器临时明文已删除；未输出凭据')
