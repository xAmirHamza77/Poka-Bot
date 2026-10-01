import json
import unittest
from unittest.mock import patch
import httpx
from app.services.provider_service import ModelProviderService
from app.schemas.contracts import AppSettingsSchema
from app.routers import settings as settings_router

class ChatCompletionsTests(unittest.IsolatedAsyncioTestCase):
    async def run_stream(self, text, key='test-key', status=200, messages=None):
        self.requests = []
        def handler(request):
            self.requests.append(request)
            return httpx.Response(status, text=text)
        config = {'model_api_base_url': 'http://localhost:11434/v1', 'model_api_wire_api': 'chat_completions', 'model_api_key': key, 'model_api_headers': {'x-test': 'value'}}
        with patch('app.services.provider_service.storage_service.get_settings', return_value=config), patch('app.services.provider_service.settings.MODEL_API_KEY', ''), patch('app.services.provider_service.httpx.AsyncClient', return_value=httpx.AsyncClient(transport=httpx.MockTransport(handler))):
            return [e async for e in ModelProviderService().stream_chat_completion('my-exact-model', messages or [{'role': 'user', 'content': 'Hi'}], 'Be helpful')]
    def sse(self, *events):
        return ''.join('data: ' + (e if isinstance(e, str) else json.dumps(e)) + '\n\n' for e in events)
    async def test_history_images_model_headers_and_keyless_local_server(self):
        events = await self.run_stream(self.sse({'choices': [{'index': 0, 'delta': {'content': 'Hello'}, 'finish_reason': None}]}, {'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]}, '[DONE]'), key='', messages=[{'role': 'user', 'content': 'Describe', 'image_url': 'data:image/png;base64,YQ=='}])
        self.assertEqual(events, [{'type': 'content.delta', 'delta': 'Hello'}, {'type': 'turn.completed', 'ok': True}])
        req = self.requests[0]
        self.assertEqual(str(req.url), 'http://localhost:11434/v1/chat/completions')
        self.assertNotIn('authorization', req.headers)
        body = json.loads(req.content)
        self.assertEqual(body['model'], 'my-exact-model')
        self.assertEqual(body['messages'][0], {'role': 'system', 'content': 'Be helpful'})
        self.assertEqual(body['messages'][1]['content'][1]['type'], 'image_url')
    async def test_truncated_length_and_http_errors_fail_without_exposing_body(self):
        for text, status in [(self.sse('[DONE]'), 200), (self.sse({'choices': [{'delta': {}, 'finish_reason': 'length'}]}), 200), ('private-provider-body', 401)]:
            events = await self.run_stream(text, status=status)
            self.assertFalse(events[-1]['ok'])
            self.assertNotIn('private-provider-body', json.dumps(events))
    async def test_protocol_schema(self):
        self.assertEqual(AppSettingsSchema(model_api_wire_api='chat_completions').model_api_wire_api, 'chat_completions')

class ProviderConnectionTests(unittest.IsolatedAsyncioTestCase):
    async def test_catalog_reports_exact_model_without_leaking_credentials(self):
        config = {'model_api_base_url': 'https://provider.test/v1', 'model_api_wire_api': 'chat_completions', 'model_api_key': 'secret', 'default_model': 'exact-model'}
        requests = []
        def handler(request):
            requests.append(request)
            return httpx.Response(200, json={'data': [{'id': 'exact-model'}]})
        with patch.object(settings_router.storage_service, 'get_settings', return_value=config), patch.object(settings_router.httpx, 'AsyncClient', return_value=httpx.AsyncClient(transport=httpx.MockTransport(handler))):
            result = await settings_router.test_provider()
        self.assertTrue(result['default_model_found'])
        self.assertEqual(str(requests[0].url), 'https://provider.test/v1/models')
        self.assertEqual(requests[0].headers['authorization'], 'Bearer secret')
        self.assertNotIn('secret', json.dumps(result))
