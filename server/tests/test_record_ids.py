import json
import tempfile
import unittest
import uuid
from contextlib import ExitStack
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx

from app.main import app
from app.routers import bots, chat
from app.services.auth_service import auth_service
from app.services.storage_service import StorageService
from app.services.task_service import TaskService
import importlib
task_module = importlib.import_module("app.services.task_service")


class RecordIdentityTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.storage = StorageService(Path(self.directory.name))
        self.patches = ExitStack()
        self.tasks = TaskService(self.storage)
        self.patches.enter_context(patch.object(task_module, "task_service", self.tasks))
        self.storage.save_bots([{"id": name, "name": name, "model": "test", "system_prompt": "Test"} for name in ("thread-one", "thread-two", "test-thread")])
        for router in (bots, chat):
            self.patches.enter_context(patch.object(router, "storage_service", self.storage))
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 12345)),
            base_url="http://127.0.0.1",
        )
        await self.client.post("/api/v1/auth/login", json={"token": auth_service.token})

    async def asyncTearDown(self):
        await self.tasks.shutdown()
        await self.client.aclose()
        self.patches.close()
        self.directory.cleanup()

    def matching_prefix_uuids(self, router):
        # Distinct valid UUIDs whose first six hex digits collide.
        values = [
            uuid.UUID("abcdef00-0000-4000-8000-000000000001"),
            uuid.UUID("abcdef00-0000-4000-8000-000000000002"),
        ]
        return patch.object(router, "uuid", SimpleNamespace(uuid4=Mock(side_effect=values)))

    async def test_user_messages_with_matching_uuid_prefixes_preserve_both_threads(self):
        original = self.storage.get_messages()
        with self.matching_prefix_uuids(chat), patch.object(self.tasks, "start"):
            for thread, text in (("thread-one", "First message"), ("thread-two", "Second message")):
                response = await self.client.post(
                    "/api/v1/chat/send",
                    json={"thread_id": thread, "bot_id": thread, "user_text": text, "request_id": thread},
                )
                self.assertEqual(response.status_code, 200)

        self.assertEqual(len(self.storage.get_messages()), len(original) + 2)
        self.assertEqual(self.storage.get_messages("thread-one")[0]["text"], "First message")
        self.assertEqual(self.storage.get_messages("thread-two")[0]["text"], "Second message")
        self.assertEqual(self.storage.get_messages()[:len(original)], original)

    async def test_assistant_reply_does_not_replace_user_with_matching_uuid_prefix(self):
        async def stream(**kwargs):
            yield {"type": "content.delta", "delta": "Assistant reply"}
            yield {"type": "turn.completed", "ok": True}

        with self.matching_prefix_uuids(chat), patch.object(
            chat.provider_service, "stream_chat_completion", stream
        ):
            sent = await self.client.post(
                "/api/v1/chat/send",
                json={"thread_id": "test-thread", "bot_id": "test-thread", "user_text": "Question", "request_id": "test"},
            )
            self.assertEqual(sent.status_code, 200)
            response = await self.client.get("/api/v1/chat/stream/test-thread")
            self.assertEqual(response.status_code, 200)

        history = await self.client.get("/api/v1/chat/history/test-thread")
        self.assertEqual(history.status_code, 200)
        messages = history.json()
        self.assertEqual([m["text"] for m in messages], ["Question", "Assistant reply"])
        self.assertNotEqual(messages[0]["id"], messages[1]["id"])
        events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]
        self.assertEqual(events[0]["botMsgId"], messages[1]["id"])
        self.assertEqual(events[-1]["botMsgId"], messages[1]["id"])

    async def test_bots_with_matching_uuid_prefixes_remain_independently_editable(self):
        original = self.storage.get_bots()
        with self.matching_prefix_uuids(bots):
            first = await self.client.post("/api/v1/bots", json={"name": "First bot"})
            second = await self.client.post("/api/v1/bots", json={"name": "Second bot"})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(len(self.storage.get_bots()), len(original) + 2)
        edited = await self.client.put(
            f"/api/v1/bots/{first.json()['id']}", json={"name": "Edited first bot"}
        )
        self.assertEqual(edited.status_code, 200)
        records = {bot["id"]: bot for bot in self.storage.get_bots()}
        self.assertEqual(records[first.json()["id"]]["name"], "Edited first bot")
        self.assertEqual(records[second.json()["id"]]["name"], "Second bot")
        self.assertEqual(self.storage.get_bots()[:len(original)], original)
