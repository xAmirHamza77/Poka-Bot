"""Small You.com adapter used by governed search actions."""

import json
from typing import Any, Dict, Tuple

import httpx

from app.config import settings
from app.services.storage_service import StorageService, storage_service


YOUCOM_MCP_URL = "https://api.you.com/mcp"
YOUCOM_FREE_PROFILE = "free"
YOUCOM_SEARCH_TOOL = "you-search"
MAX_QUERY_CHARS = 400


class SearchServiceError(ValueError):
    """Raised when a search action cannot be validated or completed."""


def parse_mcp_response(text: str) -> Dict[str, Any]:
    """Return the decoded tool output from a You.com MCP response.

    The endpoint answers with server-sent events and may emit progress
    notifications before the result, so the last ``data:`` line carrying
    a ``result`` wins.
    """
    result: Dict[str, Any] = {}
    for raw_line in text.splitlines():
        if raw_line.startswith("data: "):
            line = raw_line[6:]
        elif raw_line.lstrip().startswith("{"):
            line = raw_line
        else:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(message, dict):
            continue
        if message.get("error"):
            error = message["error"]
            raise SearchServiceError(error.get("message", "The search provider returned an error."))
        if "result" in message:
            result = message["result"]

    if not result:
        raise SearchServiceError("The search provider returned an empty response.")

    content = next(
        (
            item.get("text")
            for item in (result.get("content") or [])
            if item.get("type") == "text"
        ),
        None,
    )
    if result.get("isError"):
        raise SearchServiceError(content or "The search provider returned an error.")

    if not content:
        return result
    try:
        decoded = json.loads(content)
    except json.JSONDecodeError:
        return {"text": content}
    return decoded if isinstance(decoded, dict) else {"data": decoded}


class YoucomService:
    def __init__(self, storage: StorageService = storage_service):
        self.storage = storage

    def get_api_key(self) -> str:
        config = self.storage.get_settings()
        return str(
            config.get("youcom_api_key")
            or config.get("ydc_api_key")
            or settings.YDC_API_KEY
            or ""
        )

    def get_endpoint(self) -> Tuple[str, Dict[str, str]]:
        """Return the MCP endpoint URL and headers for the current key.

        Without a key the keyless free profile is used, which serves a
        reduced read-only tool set. With a key the authenticated endpoint
        is used for higher limits.
        """
        headers = {
            "content-type": "application/json",
            "accept": "application/json, text/event-stream",
        }
        key = self.get_api_key()
        if key:
            headers["authorization"] = f"Bearer {key}"
            return YOUCOM_MCP_URL, headers
        return f"{YOUCOM_MCP_URL}?profile={YOUCOM_FREE_PROFILE}", headers

    async def call_tool(
        self,
        name: str,
        arguments: Dict[str, Any],
    ) -> Dict[str, Any]:
        url, headers = self.get_endpoint()
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                url,
                headers=headers,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "tools/call",
                    "params": {"name": name, "arguments": arguments},
                },
            )
            response.raise_for_status()
            return parse_mcp_response(response.text)

    async def search_web(
        self,
        query: str,
        count: int = 5,
    ) -> Dict[str, Any]:
        query = (query or "").strip()
        if not query or len(query) > MAX_QUERY_CHARS:
            raise SearchServiceError(
                f"A search query must be between 1 and {MAX_QUERY_CHARS} characters."
            )
        if not isinstance(count, int) or not 1 <= count <= 10:
            raise SearchServiceError("The search result count must be between 1 and 10.")

        payload = await self.call_tool(
            YOUCOM_SEARCH_TOOL,
            {"query": query, "count": count},
        )

        container = payload.get("results", payload) if isinstance(payload, dict) else {}
        raw_results = (
            container.get("web")
            if isinstance(container, dict)
            else container
            if isinstance(container, list)
            else []
        )
        if not isinstance(raw_results, list):
            raw_results = []

        results = []
        for item in raw_results[:count]:
            if not isinstance(item, dict):
                continue
            contents = item.get("contents") or {}
            highlights = contents.get("highlights") or [] if isinstance(contents, dict) else []
            snippet = str(item.get("description") or "").strip()
            results.append(
                {
                    "title": item.get("title"),
                    "url": item.get("url"),
                    "snippet": snippet[:280],
                    "highlights": [
                        str(highlight).strip()[:200]
                        for highlight in highlights[:2]
                        if str(highlight).strip()
                    ],
                }
            )

        return {
            "provider": "youcom",
            "operation": "web_search",
            "query": query,
            "count": len(results),
            "results": results,
        }


youcom_service = YoucomService()