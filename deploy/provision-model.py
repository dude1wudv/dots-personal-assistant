import argparse
import json
import os
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--key-id', type=int, required=True)
parser.add_argument('--group-id', type=int, required=True)
parser.add_argument('--db-container', default='sub2api-postgres')
parser.add_argument('--base-url', default='http://sub2api:8080/v1')
args = parser.parse_args()
if args.key_id <= 0 or args.group_id <= 0:
    raise SystemExit('Invalid key metadata')
output = Path('/opt/dots/secrets/model.json')
if output.exists():
    raise SystemExit('模型配置已存在，不覆盖现有秘密')
query = f"SELECT k.key FROM api_keys k JOIN users u ON u.id=k.user_id WHERE k.id={args.key_id} AND k.group_id={args.group_id} AND u.role='admin' AND k.status='active' AND k.deleted_at IS NULL AND (k.expires_at IS NULL OR k.expires_at>now());"
result = subprocess.run(['docker', 'exec', args.db_container, 'sh', '-c', 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "$1"', 'sh', query], capture_output=True, text=True, check=True)
key = result.stdout.strip()
if not key or '\n' in key:
    raise SystemExit('指定管理员自用Key不可用；未输出凭据')
config = {'base_url': args.base_url, 'api_key': key, 'model_mapping': {}}
fd = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as file:
    json.dump(config, file)
os.chown(output, 10001, 10001)
print('自用组模型入口已安全配置；现有路由及Key状态未修改，秘密仅留服务器')
