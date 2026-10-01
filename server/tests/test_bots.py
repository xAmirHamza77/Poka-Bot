import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app.main import app
from app.routers import bots as bots_router
from app.services.auth_service import auth_service
from app.services.storage_service import StorageService


class BotValidationApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.storage = StorageService(Path(self.directory.name))
        self.patch = patch.object(bots_router, "storage_service", self.storage)
        self.patch.start()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 12345)),
            base_url="http://127.0.0.1",
        )
        await self.client.post("/api/v1/auth/login", json={"token": auth_service.token})

    async def asyncTearDown(self):
        await self.client.aclose()
        self.patch.stop()
        self.directory.cleanup()

    async def test_invalid_create_and_update_do_not_persist(self):
        before = self.storage.get_bots()
        invalid_create = await self.client.post("/api/v1/bots", json={"name": None})
        self.assertEqual(invalid_create.status_code, 422)
        self.assertEqual(self.storage.get_bots(), before)

        valid_create = await self.client.post("/api/v1/bots", json={"name": "Valid bot"})
        self.assertEqual(valid_create.status_code, 200)
        bot_id = valid_create.json()["id"]
        invalid_update = await self.client.put(f"/api/v1/bots/{bot_id}", json={"name": None})
        self.assertEqual(invalid_update.status_code, 422)
        self.assertEqual(self.storage.get_bots()[-1]["name"], "Valid bot")
        listed = await self.client.get("/api/v1/bots")
        self.assertEqual(listed.status_code, 200)


if __name__ == "__main__":
    unittest.main()
