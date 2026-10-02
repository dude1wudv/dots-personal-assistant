import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path


class Store:
    def __init__(self, path: str):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        with self.connect() as db:
            db.executescript('''
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, device TEXT NOT NULL, created REAL NOT NULL, expires REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL DEFAULT 'high', status TEXT NOT NULL DEFAULT 'idle', turn_id TEXT, created REAL NOT NULL, updated REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT UNIQUE, thread_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL, created REAL NOT NULL);
                CREATE INDEX IF NOT EXISTS events_thread ON events(thread_id,id);
                CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, thread_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS routines(id TEXT PRIMARY KEY, title TEXT NOT NULL, prompt TEXT NOT NULL, cron TEXT NOT NULL, timezone TEXT NOT NULL, model TEXT NOT NULL, enabled INTEGER NOT NULL, next_run REAL NOT NULL, thread_id TEXT, last_error TEXT);
                CREATE TABLE IF NOT EXISTS bots(id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, memory TEXT NOT NULL DEFAULT '', color TEXT NOT NULL, created REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL DEFAULT 'high', status TEXT NOT NULL DEFAULT 'idle', created REAL NOT NULL, updated REAL NOT NULL);
                CREATE TABLE IF NOT EXISTS group_members(group_id TEXT NOT NULL REFERENCES groups(id), thread_id TEXT NOT NULL REFERENCES conversations(id), position INTEGER NOT NULL, PRIMARY KEY(group_id,thread_id));
                CREATE TABLE IF NOT EXISTS group_queue(id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT NOT NULL REFERENCES groups(id), thread_id TEXT NOT NULL REFERENCES conversations(id), text TEXT NOT NULL, model TEXT NOT NULL, effort TEXT NOT NULL, attachments TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued');
            ''')
            for table in ('conversations', 'routines'):
                if 'bot_id' not in {row['name'] for row in db.execute(f'PRAGMA table_info({table})')}:
                    db.execute(f"ALTER TABLE {table} ADD COLUMN bot_id TEXT NOT NULL DEFAULT 'default'")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        try:
            with db:
                yield db
        finally:
            db.close()

    def rows(self, query, args=()):
        with self.connect() as db:
            return [dict(row) for row in db.execute(query, args)]

    def one(self, query, args=()):
        rows = self.rows(query, args)
        return rows[0] if rows else None

    def execute(self, query, args=()):
        with self.connect() as db:
            cursor = db.execute(query, args)
            return cursor.rowcount

    def setting(self, key, default=None):
        row = self.one('SELECT value FROM settings WHERE key=?', (key,))
        return json.loads(row['value']) if row else default

    def set(self, key, value):
        self.execute('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', (key, json.dumps(value, ensure_ascii=False)))

    def event(self, kind, payload, thread_id=None, source=None):
        self.execute('INSERT OR IGNORE INTO events(source,thread_id,kind,payload,created) VALUES(?,?,?,?,?)', (source, thread_id, kind, json.dumps(payload, ensure_ascii=False), time.time()))

    def events(self, after=0, thread_id=None, limit=500):
        where, args = ('id>?', [after])
        if thread_id:
            where += ' AND thread_id=?'
            args.append(thread_id)
        rows = self.rows(f'SELECT * FROM events WHERE {where} ORDER BY id LIMIT ?', (*args, limit))
        for row in rows:
            row['payload'] = json.loads(row['payload'])
        return rows
