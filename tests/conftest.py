import os
import tempfile
from pathlib import Path


_TEST_STATE = tempfile.TemporaryDirectory(prefix='dots-tests-')
_TEST_ROOT = Path(_TEST_STATE.name)
os.environ['DOTS_STATE'] = str(_TEST_ROOT / 'state')
os.environ['OWNER_FILE'] = str(_TEST_ROOT / 'owner.json')
os.environ['MODEL_FILE'] = str(_TEST_ROOT / 'model.json')
