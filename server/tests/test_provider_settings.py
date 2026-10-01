import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app.main import app
from app.routers import settings as settings_router
from app.services.storage_service import StorageService
from app.services.auth_service import auth_service


class ProviderSettingsApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.storage = StorageService(Path(self.directory.name))
        self.patch = patch.object(settings_router, "storage_service", self.storage)
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

    async def test_provider_form_round_trip_and_blank_credentials_preserve_secrets(self):
        response = await self.client.post("/api/v1/settings", json={
            "model_api_base_url": " https://custom.example/v1/ ",
            "model_api_wire_api": "responses",
            "model_api_key": "test-private-key",
            "model_api_headers": {"x-custom-auth": "test-header-secret"},
            "model_ids": [" custom-model ", "custom-model", "second-model"],
            "default_model": " custom-model ",
        })
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["model_api_base_url"], "https://custom.example/v1")
        self.assertEqual(data["model_ids"], ["custom-model", "second-model"])
        self.assertEqual(data["default_model"], "custom-model")
        self.assertEqual(data["model_api_key"], "")
        self.assertEqual(data["model_api_headers"], {})
        self.assertTrue(data["model_api_headers_configured"])
        await self.client.post("/api/v1/settings", json={"model_api_key": "", "model_api_headers": {}})
        await self.client.post("/api/v1/settings", json={"composio_api_key": "connector-key"})
        reopened = StorageService(Path(self.directory.name)).get_settings()
        self.assertEqual(reopened["model_api_key"], "test-private-key")
        self.assertEqual(reopened["model_api_headers"], {"x-custom-auth": "test-header-secret"})
        self.assertEqual(reopened["model_api_wire_api"], "responses")

    async def test_remove_headers_is_explicit_and_does_not_clear_api_key(self):
        self.storage.save_settings({"model_api_key": "test-key", "model_api_headers": {"x-old": "old-value"}})
        response = await self.client.post("/api/v1/settings", json={"clear_model_api_headers": True})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["model_api_headers_configured"])
        self.assertEqual(self.storage.get_settings()["model_api_headers"], {})
        self.assertEqual(self.storage.get_settings()["model_api_key"], "test-key")
        await self.client.post("/api/v1/settings", json={"model_api_headers": {"x-new": "new-value"}})
        self.assertEqual(self.storage.get_settings()["model_api_headers"], {"x-new": "new-value"})

    async def test_partial_settings_update_preserves_omitted_values(self):
        self.storage.save_settings({
            "model_api_base_url": "https://saved.example/v1",
            "default_model": "saved-model",
            "theme": "dark",
        })
        response = await self.client.post("/api/v1/settings", json={"theme": "light"})
        self.assertEqual(response.status_code, 200)
        saved = self.storage.get_settings()
        self.assertEqual(saved["theme"], "light")
        self.assertEqual(saved["model_api_base_url"], "https://saved.example/v1")
        self.assertEqual(saved["default_model"], "saved-model")

    async def test_invalid_form_data_is_rejected_before_persistence(self):
        initial = self.storage.get_settings()
        for fields in [
            {"model_api_base_url": "file:///tmp/provider"},
            {"model_api_base_url": "https://example.test/v1?key=secret"},
            {"model_api_base_url": "https://user:secret@example.test/v1"},
            {"model_api_headers": {"bad header": "value"}},
            {"model_api_headers": {"x-test": "value\r\ninjected: yes"}},
            {"model_api_headers": {"X-Test": "one", "x-test": "two"}},
            {"model_api_wire_api": "unsupported"},
            {"default_model": "  "},
        ]:
            with self.subTest(fields=fields):
                response = await self.client.post("/api/v1/settings", json=fields)
                self.assertEqual(response.status_code, 422)
                self.assertEqual(self.storage.get_settings(), initial)
