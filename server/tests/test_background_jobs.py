import asyncio
import tempfile
import unittest
from pathlib import Path
from app.services.storage_service import StorageService
from app.services.task_service import TaskService, JobConflict

class BackgroundJobTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.storage = StorageService(Path(self.temp.name))
        self.release = asyncio.Event()
        self.calls = 0
        async def runner(*args):
            self.calls += 1
            yield {'type': 'turn.started', 'botMsgId': 'answer'}
            await self.release.wait()
            yield {'type': 'content.delta', 'delta': 'Finished'}
            yield {'type': 'turn.completed', 'ok': True}
        self.tasks = TaskService(self.storage, runner=runner)
    async def asyncTearDown(self):
        await self.tasks.shutdown()
        self.temp.cleanup()
    def submit(self, text='Hello', request='one', thread='test'):
        message = {'id': 'msg-'+request, 'text': text, 'sender': 'user', 'thread_id': thread}
        return self.tasks.submit(thread, 'test-model', [message], {'id': thread}, request, message)
    async def wait_status(self, job, status):
        async with asyncio.timeout(3):
            while self.tasks.get(job['id'])['status'] != status:
                await asyncio.sleep(.02)
    async def test_disconnect_does_not_cancel_and_replay_does_not_rerun(self):
        job = self.submit(); self.tasks.start()
        observer = self.tasks.observe(job['id'])
        sequence, event = await anext(observer)
        self.assertEqual(event['type'], 'turn.started')
        await observer.aclose()
        self.release.set(); await self.wait_status(job, 'completed')
        events = [event async for _, event in self.tasks.observe(job['id'], sequence)]
        self.assertEqual([e['type'] for e in events], ['content.delta', 'turn.completed'])
        self.assertEqual(self.calls, 1)
    async def test_request_id_is_idempotent_and_thread_is_serialized(self):
        job = self.submit()
        self.assertEqual(self.submit()['id'], job['id'])
        self.assertEqual(len(self.storage.get_messages('test')), 1)
        with self.assertRaises(JobConflict): self.submit(request='two')
        with self.assertRaises(JobConflict): self.submit(request='one', thread='other')
    async def test_restart_resumes_inference_without_observer(self):
        job = self.submit(); self.tasks.start()
        await self.wait_status(job, 'running'); await self.tasks.shutdown()
        restored = TaskService(StorageService(Path(self.temp.name)), runner=self.tasks.runner)
        restored.recover(); self.release.set(); restored.start()
        self.tasks = restored
        await self.wait_status(job, 'completed')
        self.assertEqual(self.tasks.get(job['id'])['attempts'], 2)
    async def test_restart_does_not_repeat_tool_actions(self):
        job = self.submit('/write important.txt value'); self.tasks.start()
        await self.wait_status(job, 'running'); await self.tasks.shutdown()
        self.tasks.recover()
        self.assertEqual(self.tasks.get(job['id'])['status'], 'interrupted')
    async def test_cancel_and_timeout_are_terminal(self):
        job = self.submit(); self.tasks.start(); await self.wait_status(job, 'running')
        self.tasks.cancel(job['id']); await self.wait_status(job, 'cancelled')
        self.tasks.timeout = .05
        job = self.submit(request='two'); await self.wait_status(job, 'failed')
        self.assertIn('time limit', self.tasks.get(job['id'])['error'])
