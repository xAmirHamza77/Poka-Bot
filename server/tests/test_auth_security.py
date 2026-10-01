import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

from app.config import settings
from app.main import app
from app.services.auth_service import AuthService, SESSION_COOKIE


class AuthenticationBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        with patch.dict(os.environ, {"APP_AUTH_TOKEN": "test-owner-credential"}):
            self.service = AuthService(Path(self.directory.name))
        self.patches = [patch("app.main.auth_service", self.service), patch("app.routers.auth.auth_service", self.service)]
        for item in self.patches:
            item.start()
        self.client = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, client=("127.0.0.1", 12345)),
            base_url="http://127.0.0.1",
        )

    async def asyncTearDown(self):
        await self.client.aclose()
        for item in reversed(self.patches):
            item.stop()
        self.directory.cleanup()

    async def login(self, **kwargs):
        return await self.client.post("/api/v1/auth/login", json={"token": self.service.token}, **kwargs)

    async def test_loopback_proxy_and_container_hostnames_cannot_bootstrap(self):
        # Test the vulnerable default case as well as an explicitly configured token.
        for configured in ("", "test-owner-credential"):
            self.service.configured_token = configured
            for host in ("127.0.0.1", "localhost", "host.docker.internal", "attacker.example"):
                with self.subTest(configured=bool(configured), host=host):
                    response = await self.client.get("/api/v1/auth/session", headers={"Host": host, "X-Forwarded-For": "127.0.0.1"})
                    self.assertEqual(response.status_code, 401)
                    self.assertNotIn("set-cookie", response.headers)
        self.assertEqual((await self.client.get("/api/v1/bots")).status_code, 401)
        self.assertEqual((await self.client.post("/api/v1/settings", json={})).status_code, 401)
        self.assertEqual((await self.client.post("/api/v1/approvals/respond", json={"request_id": "test", "action": "allow"})).status_code, 401)

    async def test_login_issues_distinct_httponly_session_and_rejects_master_cookie(self):
        response = await self.login()
        self.assertEqual(response.status_code, 200)
        cookie = self.client.cookies.get(SESSION_COOKIE)
        self.assertNotEqual(cookie, self.service.token)
        self.assertIn("HttpOnly", response.headers["set-cookie"])
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertNotIn(cookie, repr(self.service._sessions))
        self.assertEqual((await self.client.get("/api/v1/bots")).status_code, 200)
        self.client.cookies.clear()
        self.client.cookies.set(SESSION_COOKIE, self.service.token)
        self.assertEqual((await self.client.get("/api/v1/bots")).status_code, 401)

    async def test_logout_revokes_replayed_cookie_but_preserves_other_sessions(self):
        await self.login()
        first_cookie = self.client.cookies.get(SESSION_COOKIE)
        self.client.cookies.clear()
        await self.login()
        second_cookie = self.client.cookies.get(SESSION_COOKIE)
        await self.client.post("/api/v1/auth/logout")
        self.client.cookies.set(SESSION_COOKIE, second_cookie)
        self.assertEqual((await self.client.get("/api/v1/auth/session")).status_code, 401)
        self.client.cookies.clear()
        self.client.cookies.set(SESSION_COOKIE, first_cookie)
        self.assertEqual((await self.client.get("/api/v1/auth/session")).status_code, 200)

    async def test_session_expiry_is_enforced_on_server_and_restart_invalidates_sessions(self):
        with patch("app.services.auth_service.monotonic", return_value=100):
            await self.login()
        cookie = self.client.cookies.get(SESSION_COOKIE)
        with patch("app.services.auth_service.monotonic", return_value=101 + settings.AUTH_SESSION_MAX_AGE):
            self.assertEqual((await self.client.get("/api/v1/bots")).status_code, 401)
        with patch.dict(os.environ, {"APP_AUTH_TOKEN": self.service.token}):
            restarted = AuthService(Path(self.directory.name))
        self.assertFalse(restarted.authenticate_session(cookie))

    async def test_bearer_credential_still_works_for_direct_clients(self):
        response = await self.client.get("/api/v1/bots", headers={"Authorization": "Bearer " + self.service.token})
        self.assertEqual(response.status_code, 200)
        session = await self.client.get("/api/v1/auth/session", headers={"Authorization": "Bearer " + self.service.token})
        self.assertEqual(session.status_code, 200)
        self.assertNotEqual(self.client.cookies.get(SESSION_COOKIE), self.service.token)

    async def test_wrong_and_unicode_credentials_return_401_without_session(self):
        for token in ("wrong-token", "错误令牌"):
            response = await self.client.post("/api/v1/auth/login", json={"token": token})
            self.assertEqual(response.status_code, 401)
            self.assertNotIn("set-cookie", response.headers)

    async def test_untrusted_origins_cannot_login_or_change_authenticated_state(self):
        response = await self.login(headers={"Origin": "https://untrusted.example"})
        self.assertEqual(response.status_code, 403)
        await self.login()
        for path, body in (("/api/v1/auth/logout", {}), ("/api/v1/settings", {}), ("/api/v1/approvals/respond", {"request_id": "test", "action": "allow"})):
            response = await self.client.post(path, json=body, headers={"Origin": "http://127.0.0.1:9999"})
            self.assertEqual(response.status_code, 403)
        self.assertEqual((await self.client.get("/api/v1/auth/session")).status_code, 200)
        self.assertEqual((await self.client.get("/api/v1/chat/stream/test", headers={"Sec-Fetch-Site": "cross-site"})).status_code, 403)

    async def test_allowed_frontend_can_read_401_and_then_login(self):
        origin = settings.CORS_ORIGINS[0]
        response = await self.client.get("/api/v1/bots", headers={"Origin": origin})
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.headers["access-control-allow-origin"], origin)
        self.assertEqual((await self.login(headers={"Origin": origin})).status_code, 200)
        self.assertEqual((await self.client.get("/api/v1/bots", headers={"Origin": origin})).status_code, 200)

    async def test_simple_request_without_content_type_cannot_change_settings(self):
        await self.login()
        # A Blob with no MIME type is a browser simple request: no preflight.
        response = await self.client.post(
            "/api/v1/settings",
            content=b'{"default_model":"csrf-test-model"}',
            headers={"Origin": "http://127.0.0.1:9999", "Sec-Fetch-Site": "same-site"},
        )
        self.assertEqual(response.status_code, 403)

    async def test_session_refresh_does_not_mint_sessions_and_relogin_revokes_old_cookie(self):
        await self.login()
        first = self.client.cookies.get(SESSION_COOKIE)
        for _ in range(3):
            response = await self.client.get("/api/v1/auth/session")
            self.assertEqual(response.status_code, 200)
            self.assertNotIn("set-cookie", response.headers)
        self.assertEqual(len(self.service._sessions), 1)
        await self.login()
        self.assertFalse(self.service.authenticate_session(first))
        self.assertEqual(len(self.service._sessions), 1)
        for _ in range(130):
            self.client.cookies.clear()
            await self.login()
        self.assertLessEqual(len(self.service._sessions), 128)

    async def test_secure_cookie_is_enabled_by_https_or_explicit_configuration(self):
        with patch.object(settings, "AUTH_COOKIE_SECURE", True):
            response = await self.login()
            self.assertIn("Secure", response.headers["set-cookie"])
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="https://api.example") as client:
            response = await client.post("/api/v1/auth/login", json={"token": self.service.token})
            self.assertIn("Secure", response.headers["set-cookie"])
