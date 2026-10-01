import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import httpx

from app.services.provider_service import ModelProviderService
from app.services.storage_service import StorageService
from app.schemas.contracts import AppSettingsSchema
from app.routers import settings as settings_router
from app.routers import chat as chat_router
from app.main import app
from app.services.auth_service import auth_service


class ResponsesProviderTests(unittest.IsolatedAsyncioTestCase):
    async def run_provider(self, response, messages=None, wire_api="responses"):
        self.requests = []

        def handler(request):
            self.requests.append(request)
            return response

        config = {
            "model_api_key": "test-secret",
            "model_api_base_url": "https://provider.test/v1",
            "model_api_wire_api": wire_api,
            "model_api_headers": {"x-provider-auth": "header-secret"},
        }
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
        with patch("app.services.provider_service.storage_service.get_settings", return_value=config), \
             patch("app.services.provider_service.httpx.AsyncClient", return_value=client):
            return [event async for event in ModelProviderService().stream_chat_completion(
                "exact.model-id", messages or [{"role": "user", "content": "Hello"}], "Be helpful",
            )]

    @staticmethod
    def sse(*events):
        body = ": heartbeat\n\n" + "".join("data: " + json.dumps(event) + "\n\n" for event in events)
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    async def test_stream_preserves_model_history_images_and_headers(self):
        messages = [
            {"role": "user", "content": "First question"},
            {"role": "assistant", "content": "First answer"},
            {"role": "user", "content": "Describe", "image_url": "data:image/png;base64,YQ=="},
        ]
        events = await self.run_provider(self.sse(
            {"type": "response.output_text.delta", "delta": "Hello "},
            {"type": "response.output_text.delta", "delta": "world"},
            {"type": "response.completed"},
        ), messages)
        self.assertEqual(events, [
            {"type": "content.delta", "delta": "Hello "},
            {"type": "content.delta", "delta": "world"},
            {"type": "turn.completed", "ok": True},
        ])
        request = self.requests[0]
        self.assertEqual(str(request.url), "https://provider.test/v1/responses")
        self.assertEqual(request.headers["authorization"], "Bearer test-secret")
        self.assertEqual(request.headers["x-provider-auth"], "header-secret")
        body = json.loads(request.content)
        self.assertEqual(body["model"], "exact.model-id")
        self.assertEqual(body["input"][:2], messages[:2])
        self.assertEqual(body["input"][2]["content"][1]["type"], "input_image")
        self.assertEqual(body["instructions"], "Be helpful")
        self.assertFalse(body["store"])
        self.assertTrue(body["stream"])

    async def test_http_error_does_not_expose_upstream_secrets(self):
        events = await self.run_provider(httpx.Response(401, text="test-secret header-secret"))
        self.assertFalse(events[-1]["ok"])
        self.assertIn("401", events[0]["delta"])
        self.assertNotIn("test-secret", json.dumps(events))
        self.assertNotIn("header-secret", json.dumps(events))

    async def test_failed_incomplete_and_truncated_streams_do_not_succeed(self):
        for terminal in ["response.failed", "response.incomplete", "error", None]:
            with self.subTest(terminal=terminal):
                response = self.sse(*([{"type": terminal}] if terminal else []))
                events = await self.run_provider(response)
                self.assertFalse(events[-1]["ok"])

    async def test_prediction_protocol_still_works(self):
        events = await self.run_provider(httpx.Response(200, json={"outputs": ["Legacy"]}), wire_api="prediction")
        self.assertEqual(str(self.requests[0].url), "https://provider.test/v1/exact.model-id")
        self.assertEqual(events[0]["delta"], "Legacy")
        self.assertTrue(events[-1]["ok"])


class ProviderSettingsTests(unittest.IsolatedAsyncioTestCase):
    async def test_secrets_are_encrypted_and_partial_ui_save_preserves_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            service = StorageService(Path(directory))
            service.save_settings({
                "model_api_wire_api": "responses",
                "model_api_key": "private-api-key",
                "model_api_headers": {"x-provider-auth": "private-header-value"},
                "model_ids": ["exact.model-id"],
            })
            with patch.object(settings_router, "storage_service", service):
                public = await settings_router.save_settings(AppSettingsSchema(theme="light"))
            self.assertEqual(public.model_api_key, "")
            self.assertEqual(public.model_api_headers, {})
            reopened = StorageService(Path(directory))
            values = reopened.get_settings()
            self.assertEqual(values["model_api_wire_api"], "responses")
            self.assertEqual(values["model_api_headers"]["x-provider-auth"], "private-header-value")
            self.assertEqual(values["model_ids"], ["exact.model-id"])
            self.assertEqual(values["model_api_key"], "private-api-key")
            with reopened.database.connect() as connection:
                rows = connection.execute("SELECT value, is_secret FROM settings WHERE key IN ('model_api_key', 'model_api_headers')").fetchall()
            self.assertTrue(all(row[1] == 1 for row in rows))
            stored_values = [row[0] for row in rows]
            self.assertNotIn("private-api-key", str(stored_values))
            self.assertNotIn("private-header-value", str(stored_values))


class ChatStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_plain_chat_reaches_provider_and_preserves_completion_status(self):
        for ok in (True, False):
            with self.subTest(ok=ok):
                captured = {}

                async def fake_stream(**kwargs):
                    captured.update(kwargs)
                    yield {"type": "content.delta", "delta": "Provider result"}
                    yield {"type": "turn.completed", "ok": ok}

                storage = Mock()
                storage.get_messages.return_value = [{"sender": "user", "text": "Hello"}]
                storage.get_bots.return_value = [{"id": "chat-test", "model": "exact.model-id", "system_prompt": "Test persona"}]
                with patch.object(chat_router, "storage_service", storage), \
                     patch.object(chat_router.provider_service, "stream_chat_completion", fake_stream):
                    events = [event async for event in chat_router.generate_turn_events("chat-test")]
                self.assertIn("Test persona", captured["system_prompt"])
                self.assertEqual(captured["messages"], [{"role": "user", "content": "Hello", "image_url": None}])
                self.assertEqual(events[-1]["type"], "turn.completed")
                self.assertEqual(events[-1]["ok"], ok)
                self.assertEqual(events[0]["model"], "exact.model-id")
                if ok:
                    storage.add_message.assert_called_once()
                else:
                    storage.add_message.assert_not_called()
