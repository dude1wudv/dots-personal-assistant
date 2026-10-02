import os
import shutil
from pathlib import Path

import uvicorn

os.setgid(10002)
os.setegid(10003)
os.seteuid(10003)
try:
    home = Path(os.environ.get('CODEX_HOME', '/home/dot/.codex'))
    home.mkdir(parents=True, exist_ok=True)
    shutil.copyfile('/opt/dots/config.toml', home / 'config.toml')
finally:
    os.seteuid(0)
    os.setegid(10002)
uvicorn.run('app:app', host='0.0.0.0', port=8092, loop='asyncio', access_log=False, proxy_headers=False)
