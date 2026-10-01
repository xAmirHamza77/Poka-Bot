import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app.services.auth_service import AuthService, auth_service, SESSION_COOKIE

try:
    from app.main import app
except ModuleNotFoundError:
    app = None


class AuthServiceTests(unittest.TestCase):
    def test_local_token_is_generated_once_with_restricted_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.dict(os.environ, {"APP_AUTH_TOKEN": ""}, clear=False):
                first = AuthService(root)
                second = AuthService(root)

            self.assertEqual(first.token, second.token)
            self.assertTrue(first.authenticate_token(first.token))
            self.assertFalse(first.authenticate_token("wrong-token"))
            self.assertEqual((root / ".auth-token").stat().st_mode & 0o777, 0o600)

    def test_configured_token_does_not_create_a_local_token_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.dict(os.environ, {"APP_AUTH_TOKEN": "configured-token"}, clear=False):
                service = AuthService(root)

            self.assertTrue(service.authenticate_token("configured-token"))
            self.assertFalse((root / ".auth-token").exists())


class AuthMiddlewareTests(unittest.IsolatedAsyncioTestCase):
    @unittest.skipIf(app is None, "FastAPI dependencies are not installed")
    async def test_loopback_cannot_bootstrap_and_token_login_issues_distinct_session(self):
        transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 43123))
        async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
            unauthenticated = await client.get("/api/v1/models")
            self.assertEqual(unauthenticated.status_code, 401)

            status = await client.get("/api/v1/auth/status")
            self.assertFalse(status.json()["authenticated"])
            self.assertFalse(status.json()["bootstrap_available"])

            session = await client.get("/api/v1/auth/session")
            self.assertEqual(session.status_code, 401)
            login = await client.post("/api/v1/auth/login", json={"token": auth_service.token})
            self.assertEqual(login.status_code, 200)
            self.assertNotEqual(client.cookies.get(SESSION_COOKIE), auth_service.token)
            authenticated = await client.get("/api/v1/models")
            self.assertEqual(authenticated.status_code, 200)

            await client.post("/api/v1/auth/logout")
            logged_out = await client.get("/api/v1/models")
            self.assertEqual(logged_out.status_code, 401)

    @unittest.skipIf(app is None, "FastAPI dependencies are not installed")
    async def test_unauthorized_responses_include_cors_headers(self):
        transport = httpx.ASGITransport(app=app, client=("10.0.0.2", 43123))
        async with httpx.AsyncClient(transport=transport, base_url="http://api.example") as client:
            response = await client.get("/api/v1/models", headers={"Origin": "http://127.0.0.1:3000"})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "http://127.0.0.1:3000")


if __name__ == "__main__":
    unittest.main()
