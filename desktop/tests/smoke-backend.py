"""Run against the bundled API in disposable data, with a local test provider."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import httpx

class Provider(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        assert self.path == '/v1/models'
        body = json.dumps({'data': [{'id': 'local-smoke-model'}]}).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def do_POST(self):
        assert self.path == '/v1/chat/completions'
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        assert body['model'] == 'local-smoke-model'
        assert body['messages'][-1]['content'] == 'Hello smoke test'
        events = [{'choices': [{'index': 0, 'delta': {'content': 'Poka packaged backend works.'}, 'finish_reason': None}]}, {'choices': [{'index': 0, 'delta': {}, 'finish_reason': 'stop'}]}]
        data = ''.join('data: ' + json.dumps(e) + '\n\n' for e in events) + 'data: [DONE]\n\n'
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Content-Length', str(len(data.encode())))
        self.end_headers()
        self.wfile.write(data.encode())

executable = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'resources/backend/poka-api/poka-api'
with tempfile.TemporaryDirectory(prefix='poka-smoke-') as temp:
    provider = ThreadingHTTPServer(('127.0.0.1', 0), Provider)
    threading.Thread(target=provider.serve_forever, daemon=True).start()
    probe = socket.socket()
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
    probe.close()
    env = {**os.environ, 'PORT': str(port), 'DATA_DIR': temp, 'WORKSPACE_ROOT': temp, 'APP_AUTH_TOKEN': 'disposable-smoke-owner', 'MODEL_API_KEY': '', 'MODEL_API_BASE_URL': '', 'COMPUTER_PROVIDER': 'fake'}
    def launch():
        process = subprocess.Popen([str(executable)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(150):
            if process.poll() is not None:
                raise RuntimeError('Bundled backend exited')
            try:
                if httpx.get(f'http://127.0.0.1:{port}/api/v1/health', timeout=1).is_success:
                    return process
            except httpx.HTTPError:
                pass
            time.sleep(.1)
        process.terminate()
        raise RuntimeError('Backend did not become healthy')
    process = launch()
    try:
        with httpx.Client(base_url=f'http://127.0.0.1:{port}/api/v1', timeout=20) as client:
            assert client.get('/settings').status_code == 401
            client.post('/auth/login', json={'token': env['APP_AUTH_TOKEN']}).raise_for_status()
            assert client.get('/bots').json()[0]['name'] == 'Poka'
            response = client.post('/settings', json={'model_api_base_url': f'http://127.0.0.1:{provider.server_port}/v1', 'model_api_wire_api': 'chat_completions', 'model_ids': ['local-smoke-model'], 'default_model': 'local-smoke-model'})
            response.raise_for_status()
            assert response.json()['model_api_key'] == ''
            assert client.post('/settings/test').json()['default_model_found']
            bot = client.post('/bots', json={'name': 'Smoke assistant', 'model': 'local-smoke-model'}).json()
            client.post('/chat/send', json={'thread_id': bot['id'], 'bot_id': bot['id'], 'model': 'local-smoke-model', 'user_text': 'Hello smoke test'}).raise_for_status()
            response = client.get(f"/chat/stream/{bot['id']}")
            events = [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith('data:')]
            assert events[-1]['type'] == 'turn.completed' and events[-1]['ok']
            assert any(e.get('delta') == 'Poka packaged backend works.' for e in events)
            assert client.get(f"/chat/history/{bot['id']}").json()[-1]['text'] == 'Poka packaged backend works.'
            process.terminate()
            process.wait(timeout=10)
            process = launch()
            assert client.get('/settings').status_code == 401
            client.post('/auth/login', json={'token': env['APP_AUTH_TOKEN']}).raise_for_status()
            assert client.get('/settings').json()['default_model'] == 'local-smoke-model'
            assert client.get(f"/chat/history/{bot['id']}").json()[-1]['text'] == 'Poka packaged backend works.'
        print('PASS: bundled API authentication, branding, custom model catalog, streamed chat, persistence, and session invalidation')
    finally:
        process.terminate()
        process.wait(timeout=10)
        provider.shutdown()
