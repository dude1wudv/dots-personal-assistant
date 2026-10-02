"""Persistent execution receipts projected from the existing event stream."""
import json
import secrets
import time

TERMINAL = ('completed', 'failed', 'interrupted', 'cancelled')


def migrate(db):
    db.execute('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied REAL NOT NULL)')
    if db.execute('SELECT 1 FROM schema_migrations WHERE version=2').fetchone():
        return
    db.execute('''CREATE TABLE runs(
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, bot_id TEXT, thread_id TEXT,
        parent_id TEXT, group_id TEXT, routine_id TEXT, title TEXT NOT NULL,
        model TEXT NOT NULL, effort TEXT NOT NULL, turn_id TEXT, status TEXT NOT NULL,
        created REAL NOT NULL, started REAL, ended REAL, updated REAL NOT NULL,
        failure_stage TEXT, error TEXT, stop_requested REAL)''')
    db.execute('CREATE INDEX runs_updated ON runs(updated DESC, id DESC)')
    db.execute('CREATE UNIQUE INDEX runs_turn ON runs(thread_id, turn_id) WHERE turn_id IS NOT NULL')
    db.execute('''CREATE TABLE run_events(
        event_id INTEGER PRIMARY KEY REFERENCES events(id), run_id TEXT NOT NULL REFERENCES runs(id))''')
    db.execute('INSERT INTO schema_migrations VALUES(2,?)', (time.time(),))


def create(store, thread_id, *, kind='manual', title='未命名任务', model='gpt-6.1-sol', effort='high', bot_id=None, parent_id=None, group_id=None, routine_id=None):
    run_id = 'run-' + secrets.token_hex(12)
    now = time.time()
    store.execute('''INSERT INTO runs(id,kind,bot_id,thread_id,parent_id,group_id,routine_id,title,model,effort,status,created,updated)
                     VALUES(?,?,?,?,?,?,?,?,?,?,?, ?,?)''',
                  (run_id, kind, bot_id, thread_id, parent_id, group_id, routine_id, title[:120], model, effort, 'starting', now, now))
    return run_id


def _candidate(db, thread_id, turn_id=None):
    if turn_id:
        row = db.execute("SELECT * FROM runs WHERE thread_id=? AND turn_id=? ORDER BY created DESC LIMIT 1", (thread_id, turn_id)).fetchone()
        if row:
            return row
    return db.execute("SELECT * FROM runs WHERE thread_id=? AND status NOT IN ('completed','failed','interrupted','cancelled') ORDER BY created DESC LIMIT 1", (thread_id,)).fetchone()


def bind_start(db, thread_id, turn_id, now):
    row = _candidate(db, thread_id, turn_id)
    if not row or row['status'] in TERMINAL:
        return
    db.execute("UPDATE runs SET turn_id=?,status=CASE WHEN status='starting' THEN 'running' ELSE status END,started=COALESCE(started,?),updated=? WHERE id=? AND status NOT IN ('completed','failed','interrupted','cancelled')", (turn_id, now, now, row['id']))


def project(db, event_id, kind, payload, now):
    thread_id = payload.get('threadId') or (payload.get('thread') or {}).get('id')
    turn = payload.get('turn') or {}
    turn_id = turn.get('id')
    row = _candidate(db, thread_id, turn_id) if thread_id else None
    if row:
        db.execute('INSERT OR IGNORE INTO run_events(event_id,run_id) VALUES(?,?)', (event_id, row['id']))
    if not row:
        return
    if kind == 'turn/started' and turn_id:
        bind_start(db, thread_id, turn_id, now)
    elif kind == 'turn/completed':
        status = 'completed' if turn.get('status') == 'completed' else 'failed'
        error = (turn.get('error') or {}).get('message') if isinstance(turn.get('error'), dict) else None
        db.execute("UPDATE runs SET status=?,ended=?,updated=?,error=? WHERE id=? AND status NOT IN ('completed','failed','interrupted','cancelled')", (status, now, now, error, row['id']))
    elif kind in ('runtime/stopped', 'runtime/error'):
        db.execute("UPDATE runs SET status='interrupted',ended=?,updated=?,error=? WHERE id=? AND status NOT IN ('completed','failed','interrupted','cancelled')", (now, now, json.dumps(payload, ensure_ascii=False)[:2000], row['id']))


def bind_response(store, run_id, thread_id, turn_id):
    with store.connect() as db:
        existing = db.execute("SELECT id FROM runs WHERE thread_id=? AND turn_id=? AND id<>?", (thread_id, turn_id, run_id)).fetchone()
        if existing:
            db.execute("UPDATE runs SET status='cancelled',ended=?,updated=?,failure_stage='duplicate-turn' WHERE id=? AND status NOT IN ('completed','failed','interrupted','cancelled')", (time.time(), time.time(), run_id))
            return
        db.execute("UPDATE runs SET turn_id=?,updated=? WHERE id=? AND thread_id=? AND status NOT IN ('completed','failed','interrupted','cancelled')", (turn_id, time.time(), run_id, thread_id))


def list_runs(store, status=None, bot_id=None, limit=50):
    limit = max(1, min(limit, 200))
    where, args = [], []
    if status:
        where.append('status=?'); args.append(status)
    if bot_id:
        where.append('bot_id=?'); args.append(bot_id)
    clause = ' WHERE ' + ' AND '.join(where) if where else ''
    return store.rows(f'SELECT * FROM runs{clause} ORDER BY updated DESC,id DESC LIMIT ?', (*args, limit))


def detail(store, run_id):
    run = store.one('SELECT * FROM runs WHERE id=?', (run_id,))
    if not run:
        return None
    run['children'] = store.rows('SELECT * FROM runs WHERE parent_id=? ORDER BY created,id', (run_id,))
    run['events'] = store.rows('SELECT e.* FROM events e JOIN run_events r ON r.event_id=e.id WHERE r.run_id=? ORDER BY e.id LIMIT 500', (run_id,))
    for event in run['events']:
        event['payload'] = json.loads(event['payload'])
    return run
