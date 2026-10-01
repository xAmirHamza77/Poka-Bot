import json
import unittest

from app.config import settings
from app.services.action_gateway import ActionDefinition, ActionGateway, ActionInvocation
from app.services.youcom_service import (
    YoucomService,
    SearchServiceError,
    YOUCOM_MCP_URL,
    YOUCOM_SEARCH_TOOL,
    parse_mcp_response,
)
from app.services.search_actions import SearchCommandError, parse_search_command


class EmptyStorage:
    def get_settings(self):
        return {}


class KeyStorage:
    def get_settings(self):
        return {"youcom_api_key": "stored-key"}


class RecordingAudit:
    def __init__(self):
        self.events = []

    def add_audit_event(self, event):
        self.events.append(event)


class AllowingApprovalBroker:
    def open(self, thread_id, bot_id, call, request_id=None):
        return {
            "request_id": request_id,
            "thread_id": thread_id,
            "bot_id": bot_id,
            "tool": call.name,
            "summary": call.summary,
            "arguments": call.arguments_for_display,
            "status": "pending",
        }

    async def wait(self, request_id):
        return "allow"


FAKE_TOOL_OUTPUT = {
    "results": {
        "web": [
            {
                "url": "https://example.com/fastapi",
                "title": "FastAPI Releases",
                "description": "Release notes and current version details.",
                "thumbnail_url": "https://example.com/thumb.png",
                "favicon_url": "https://example.com/favicon.png",
                "contents": {
                    "highlights": [
                        "FastAPI 0.115 adds query parameter validation.",
                        "Migration notes for existing projects.",
                        "Unrelated trailing highlight that should be dropped.",
                    ]
                },
            },
            {
                "url": "https://example.com/pydantic",
                "title": "Pydantic Changelog",
                "description": "Historic changelog entries for the validation library.",
                "contents": {"highlights": []},
            },
        ]
    }
}


class FakeYoucomService(YoucomService):
    async def call_tool(self, name, arguments):
        self.called = (name, arguments)
        return json.loads(json.dumps(FAKE_TOOL_OUTPUT))


class KeylessYoucomService(YoucomService):
    def get_api_key(self):
        return ""


class KeyedYoucomService(YoucomService):
    def get_api_key(self):
        return "test-key"


# Captured from a live keyless response: a progress notification is emitted
# before the result, and the tool output arrives as JSON inside content text.
LIVE_SSE_RESPONSE = (
    'event: message\n'
    'data: {"jsonrpc":"2.0","method":"notifications/message","params":{"level":"info","data":"Search successful for query"}}\n'
    '\n'
    'event: message\n'
    'data: {"result":{"_meta":{"you/usage":{"sku":"search","results_returned":1}},"content":[{"type":"text","text":"{\\"results\\":{\\"web\\":[{\\"url\\":\\"https://example.com/result\\",\\"title\\":\\"Example result\\",\\"description\\":\\"A short description.\\",\\"contents\\":{\\"highlights\\":[\\"One highlight.\\"]}}]}}"}]}}\n'
)


class SearchParserTests(unittest.TestCase):
    def test_parser_accepts_explicit_web_search(self):
        call = parse_search_command("/search latest fastapi release notes")

        self.assertEqual(call.name, "search.web")
        self.assertEqual(call.arguments["query"], "latest fastapi release notes")
        self.assertEqual(call.arguments["count"], 5)
        self.assertEqual(call.target, {"provider": "youcom"})
        self.assertIn("latest fastapi release notes", call.preview)

    def test_parser_ignores_non_commands_and_lookalikes(self):
        self.assertIsNone(parse_search_command("what is the latest fastapi version"))
        self.assertIsNone(parse_search_command("/searchengine tips and tricks"))

    def test_parser_rejects_missing_or_overlong_query(self):
        with self.assertRaises(SearchCommandError):
            parse_search_command("/search")
        with self.assertRaises(SearchCommandError):
            parse_search_command("/search    ")
        with self.assertRaises(SearchCommandError):
            parse_search_command("/search " + "word " * 200)


class YoucomServiceTests(unittest.IsolatedAsyncioTestCase):
    def test_sse_parser_takes_last_result_and_decodes_tool_output(self):
        decoded = parse_mcp_response(LIVE_SSE_RESPONSE)

        web = decoded["results"]["web"]
        self.assertEqual(web[0]["url"], "https://example.com/result")
        self.assertEqual(web[0]["title"], "Example result")

    def test_sse_parser_raises_on_tool_level_error(self):
        error_text = (
            "data: "
            '{"result":{"isError":true,"content":[{"type":"text","text":"Invalid query."}]}}\n'
        )
        with self.assertRaises(SearchServiceError):
            parse_mcp_response(error_text)

    def test_sse_parser_raises_on_empty_response(self):
        with self.assertRaises(SearchServiceError):
            parse_mcp_response("")

    def test_keyless_profile_used_without_key(self):
        url, headers = KeylessYoucomService(EmptyStorage()).get_endpoint()

        self.assertEqual(url, f"{YOUCOM_MCP_URL}?profile=free")
        self.assertNotIn("authorization", headers)

    def test_authenticated_endpoint_used_with_key(self):
        url, headers = KeyedYoucomService(KeyStorage()).get_endpoint()

        self.assertEqual(url, YOUCOM_MCP_URL)
        self.assertEqual(headers["authorization"], "Bearer test-key")

    def test_storage_key_is_preferred_over_environment(self):
        original = settings.YDC_API_KEY
        self.addCleanup(setattr, settings, "YDC_API_KEY", original)

        settings.YDC_API_KEY = "env-key"
        self.assertEqual(YoucomService(KeyStorage()).get_api_key(), "stored-key")
        self.assertEqual(YoucomService(EmptyStorage()).get_api_key(), "env-key")

    async def test_search_normalizes_read_only_results(self):
        provider = FakeYoucomService(EmptyStorage())
        result = await provider.search_web("latest fastapi release notes")

        self.assertEqual(provider.called[0], YOUCOM_SEARCH_TOOL)
        self.assertEqual(provider.called[1]["query"], "latest fastapi release notes")
        self.assertEqual(result["provider"], "youcom")
        self.assertEqual(result["operation"], "web_search")
        self.assertEqual(result["count"], 2)
        self.assertEqual(result["results"][0]["title"], "FastAPI Releases")
        self.assertEqual(result["results"][0]["snippet"], "Release notes and current version details.")
        self.assertEqual(result["results"][0]["highlights"], [
            "FastAPI 0.115 adds query parameter validation.",
            "Migration notes for existing projects.",
        ])
        self.assertNotIn("thumbnail_url", result["results"][0])
        self.assertNotIn("favicon_url", result["results"][0])
        self.assertEqual(result["results"][1]["highlights"], [])

    async def test_search_validates_query_and_count(self):
        provider = YoucomService(EmptyStorage())

        with self.assertRaises(SearchServiceError):
            await provider.search_web("   ")
        with self.assertRaises(SearchServiceError):
            await provider.search_web("word " * 200)
        with self.assertRaises(SearchServiceError):
            await provider.search_web("fastapi", 0)
        with self.assertRaises(SearchServiceError):
            await provider.search_web("fastapi", 11)


class SearchActionTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_search_executor_can_use_gateway_contract(self):
        provider = FakeYoucomService(EmptyStorage())
        audit = type("Audit", (), {"events": [], "add_audit_event": lambda self, event: self.events.append(event)})()
        gateway = ActionGateway(audit=audit)

        async def execute(call):
            return await provider.search_web(
                query=call.arguments["query"],
                count=call.arguments["count"],
            )

        gateway.register_action(
            ActionDefinition(
                name="search.web",
                tool="search",
                action="web",
                intent="Search the web for current information.",
                risk="external",
                requires_approval=False,
            ),
            execute,
        )
        request, approval = gateway.open(
            "thread-test",
            "bot-test",
            ActionInvocation(
                name="search.web",
                arguments={"query": "latest fastapi release notes", "count": 5},
                target={"provider": "youcom"},
                preview='Web search for "latest fastapi release notes"',
            ),
        )

        self.assertEqual(request.tool, "search")
        self.assertEqual(request.risk, "external")
        self.assertFalse(request.requires_approval)
        self.assertIsNone(approval)

        self.assertEqual(await gateway.wait_for_decision(request), "allow")
        action_result = await gateway.execute(request)

        self.assertEqual(action_result.status, "completed")
        self.assertEqual(action_result.result["count"], 2)
        self.assertTrue(audit.events)


if __name__ == "__main__":
    unittest.main()