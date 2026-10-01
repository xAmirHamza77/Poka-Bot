"""Durable single-owner queue, independent of HTTP/SSE client lifetimes.

Run one API process per data directory. The queue and event log survive restarts;
plain inference retries are bounded, and tool jobs never replay automatically.
"""
import asyncio
import json
import os
import uuid
from datetime import datetime, timezone
from app.services.storage_service import storage_service

TERMINAL = {'completed', 'failed', 'interrupted', 'cancelled'}


def now():
    return datetime.now(timezone.utc).isoformat()


class JobConflict(Exception):
    pass


class TaskService:
    def __init__(self, storage=storage_service, runner=None, concurrency=None):
        self.storage = storage
        self.database = storage.database
        self.runner = runner
        self.concurrency = concurrency or max(1, int(os.getenv('TASK_CONCURRENCY', '2')))
        self.max_attempts = max(1, int(os.getenv('TASK_MAX_ATTEMPTS', '3')))
        self.timeout = max(1, int(os.getenv('TASK_TIMEOUT_SECONDS', '1800')))
        self.active = {}
        self.worker = None
        self.stopping = False

    def submit(self, thread_id, model, history, bot, request_id, user_message=None):
        payload = {'model': model, 'history': history, 'bot': bot,
                   'retry_safe': not (history and history[-1].get('text', '').lstrip().startswith('/'))}
        timestamp = now()
        job_id = 'job-' + uuid.uuid4().hex
        with self.database.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            existing = db.execute('SELECT * FROM background_jobs WHERE owner_id=? AND client_request_id=?', (self.storage.owner_id, request_id)).fetchone()
            if existing:
                if existing['thread_id'] != thread_id:
                    raise JobConflict('Request ID belongs to another thread.')
                return self._public(existing)
            if db.execute("SELECT 1 FROM background_jobs WHERE owner_id=? AND thread_id=? AND status IN ('queued','running')", (self.storage.owner_id, thread_id)).fetchone():
                raise JobConflict()
            if user_message:
                db.execute('INSERT INTO messages(id,thread_id,payload,owner_id) VALUES (?,?,?,?)',
                           (user_message['id'], thread_id, json.dumps(user_message), self.storage.owner_id))
            db.execute('INSERT INTO background_jobs(id,owner_id,thread_id,client_request_id,status,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)',
                       (job_id, self.storage.owner_id, thread_id, request_id, 'queued', json.dumps(payload), timestamp, timestamp))
        return self.get(job_id)

    def user_message(self, job_id):
        with self.database.connect() as db:
            row = db.execute('SELECT payload FROM background_jobs WHERE id=? AND owner_id=?', (job_id, self.storage.owner_id)).fetchone()
        return json.loads(row['payload'])['history'][-1] if row else None

    @staticmethod
    def _public(row):
        return {key: row[key] for key in ('id', 'thread_id', 'status', 'attempts', 'created_at', 'updated_at', 'error')}

    def get(self, job_id):
        with self.database.connect() as db:
            row = db.execute('SELECT * FROM background_jobs WHERE id=? AND owner_id=?', (job_id, self.storage.owner_id)).fetchone()
        return self._public(row) if row else None

    def latest(self, thread_id):
        with self.database.connect() as db:
            row = db.execute('SELECT * FROM background_jobs WHERE thread_id=? AND owner_id=? ORDER BY rowid DESC LIMIT 1', (thread_id, self.storage.owner_id)).fetchone()
        return self._public(row) if row else None

    def list(self, thread_id=None):
        with self.database.connect() as db:
            if thread_id:
                rows = db.execute('SELECT * FROM background_jobs WHERE owner_id=? AND thread_id=? ORDER BY rowid DESC LIMIT 100', (self.storage.owner_id, thread_id)).fetchall()
            else:
                rows = db.execute('SELECT * FROM background_jobs WHERE owner_id=? ORDER BY rowid DESC LIMIT 100', (self.storage.owner_id,)).fetchall()
        return [self._public(row) for row in rows]

    def emit(self, job_id, event):
        with self.database.connect() as db:
            db.execute('INSERT INTO background_job_events(job_id,payload,created_at) VALUES (?,?,?)', (job_id, json.dumps({**event, 'jobId': job_id}), now()))
            db.execute('UPDATE background_jobs SET updated_at=? WHERE id=?', (now(), job_id))

    def _status(self, job_id, status, error=None):
        with self.database.connect() as db:
            db.execute('UPDATE background_jobs SET status=?, error=?, updated_at=? WHERE id=? AND owner_id=?', (status, error, now(), job_id, self.storage.owner_id))

    def recover(self):
        with self.database.connect() as db:
            rows = db.execute("SELECT * FROM background_jobs WHERE owner_id=? AND status='running'", (self.storage.owner_id,)).fetchall()
        for row in rows:
            payload = json.loads(row['payload'])
            # An answer may have committed just before a crash. Never generate it twice.
            with self.database.connect() as db:
                events = db.execute('SELECT payload FROM background_job_events WHERE job_id=? ORDER BY sequence DESC', (row['id'],)).fetchall()
                started = next((e for e in (json.loads(r[0]) for r in events) if e.get('type') == 'turn.started'), None)
                committed = db.execute('SELECT 1 FROM messages WHERE id=?', (started.get('botMsgId', '') if started else '',)).fetchone()
            if committed:
                self.emit(row['id'], {'type': 'turn.completed', 'ok': True, 'botMsgId': started['botMsgId']})
                self._status(row['id'], 'completed')
            elif payload.get('retry_safe') and row['attempts'] < self.max_attempts:
                self.emit(row['id'], {'type': 'job.recovered', 'summary': 'Resuming inference after a server restart.'})
                self._status(row['id'], 'queued')
            else:
                reason = 'Server restarted during a tool job. Review the audit trail before submitting it again.' if not payload.get('retry_safe') else 'Restart recovery limit reached.'
                self.emit(row['id'], {'type': 'turn.completed', 'ok': False, 'error': reason})
                self._status(row['id'], 'interrupted', reason)

    def start(self):
        if self.worker is None or self.worker.done():
            self.stopping = False
            self.worker = asyncio.create_task(self._loop())

    async def _loop(self):
        while not self.stopping:
            with self.database.connect() as db:
                rows = db.execute("SELECT * FROM background_jobs WHERE owner_id=? AND status='queued' ORDER BY rowid LIMIT ?", (self.storage.owner_id, self.concurrency)).fetchall()
            for row in rows:
                if len(self.active) >= self.concurrency:
                    break
                job_id = row['id']
                with self.database.connect() as db:
                    claimed = db.execute("UPDATE background_jobs SET status='running',attempts=attempts+1,updated_at=? WHERE id=? AND status='queued'", (now(), job_id)).rowcount
                if claimed:
                    task = asyncio.create_task(self._run(job_id, json.loads(row['payload'])))
                    self.active[job_id] = task
                    task.add_done_callback(lambda _, key=job_id: self.active.pop(key, None))
            await asyncio.sleep(.2)

    async def _run(self, job_id, payload):
        completed = False
        try:
            if self.runner is None:
                from app.routers.chat import generate_turn_events
                runner = generate_turn_events
            else:
                runner = self.runner
            async with asyncio.timeout(self.timeout):
                async for event in runner(self.get(job_id)['thread_id'], payload['model'], payload['history'], payload['bot']):
                    self.emit(job_id, event)
                    if event['type'] == 'turn.completed':
                        completed = True
                        self._status(job_id, 'completed' if event.get('ok', True) else 'failed', event.get('error'))
                        break
            if not completed:
                raise RuntimeError('Provider stream ended without completion.')
        except asyncio.CancelledError:
            # Keep running status during shutdown so startup recovery can decide safely.
            if not self.stopping:
                self.emit(job_id, {'type': 'turn.completed', 'ok': False, 'error': 'Job stopped by the user.'})
                self._status(job_id, 'cancelled', 'Job stopped by the user.')
            raise
        except Exception as exc:
            # Do not persist provider credentials or raw exception bodies in UI events.
            error = 'Job exceeded its time limit.' if isinstance(exc, TimeoutError) else 'The background job failed. Check provider configuration and retry.'
            self.emit(job_id, {'type': 'turn.completed', 'ok': False, 'error': error})
            self._status(job_id, 'failed', error)

    def cancel(self, job_id):
        job = self.get(job_id)
        if not job or job['status'] in TERMINAL:
            return False
        if job_id in self.active:
            self.active[job_id].cancel()
        else:
            self.emit(job_id, {'type': 'turn.completed', 'ok': False, 'error': 'Job stopped by the user.'})
            self._status(job_id, 'cancelled')
        return True

    async def observe(self, job_id, after=0):
        while True:
            with self.database.connect() as db:
                rows = db.execute('SELECT sequence,payload FROM background_job_events WHERE job_id=? AND sequence>? ORDER BY sequence', (job_id, after)).fetchall()
            for row in rows:
                after = row['sequence']
                yield after, json.loads(row['payload'])
            job = self.get(job_id)
            if not job or job['status'] in TERMINAL:
                # Recheck the event log after reading terminal state; completion may have
                # committed between the event query and status read.
                with self.database.connect() as db:
                    remaining = db.execute('SELECT sequence,payload FROM background_job_events WHERE job_id=? AND sequence>? ORDER BY sequence', (job_id, after)).fetchall()
                for row in remaining:
                    yield row['sequence'], json.loads(row['payload'])
                return
            await asyncio.sleep(.2)

    async def shutdown(self):
        self.stopping = True
        if self.worker:
            self.worker.cancel()
        tasks = list(self.active.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, *([self.worker] if self.worker else []), return_exceptions=True)
        self.active.clear()
        self.worker = None


task_service = TaskService()
