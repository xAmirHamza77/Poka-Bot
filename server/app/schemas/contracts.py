from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field, field_validator
from urllib.parse import urlsplit
import re

class Bot(BaseModel):
    id: str
    name: str
    role: str
    description: str
    avatar: str
    model: str = "gpt-5-mini"
    accent_color: str = "cyan"
    system_prompt: str
    tools: List[str] = Field(default_factory=list)
    pinned: bool = False
    unread_count: int = 0
    created_at: str

class Message(BaseModel):
    id: str
    thread_id: str
    bot_id: str
    sender: str  # "user" | "bot" | "system"
    text: str
    created_at: str
    model: Optional[str] = None
    item_type: Optional[str] = "assistant_text"  # assistant_text, tool_call, approval_card
    image_url: Optional[str] = None
    raw_payload: Optional[Dict[str, Any]] = None

class TurnRequest(BaseModel):
    request_id: Optional[str] = Field(default=None, max_length=128)
    thread_id: str
    bot_id: str
    user_text: str
    model: Optional[str] = None
    image_url: Optional[str] = None


class ApprovalDecision(BaseModel):
    request_id: str
    action: Literal["allow", "deny"]


class ActionRequest(BaseModel):
    """The stable envelope used before a side-effecting action executes."""

    request_id: str
    thread_id: str
    bot_id: str
    tool: str
    action: str
    intent: str
    target: Dict[str, Any] = Field(default_factory=dict)
    arguments: Dict[str, Any] = Field(default_factory=dict)
    preview: str
    risk: Literal["read", "write", "external"] = "read"
    requires_approval: bool = True
    state: Literal["pending_approval", "approved"] = "pending_approval"
    created_at: str


class ActionResult(BaseModel):
    """The normalized result returned after an action is decided and run."""

    request_id: str
    status: Literal["completed", "failed", "denied", "expired"]
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: str


class ModelInfo(BaseModel):
    id: str
    name: str
    provider: str
    description: str
    recommended: bool = False
    is_available: bool = True

class AppSettingsSchema(BaseModel):
    model_api_key: str = Field(default="", json_schema_extra={"writeOnly": True})
    model_api_base_url: str = ""
    model_api_wire_api: Literal["prediction", "responses", "chat_completions"] = "prediction"
    model_api_headers: Dict[str, str] = Field(default_factory=dict, json_schema_extra={"writeOnly": True})
    model_api_headers_configured: bool = False
    clear_model_api_headers: bool = Field(default=False, json_schema_extra={"writeOnly": True})
    model_ids: List[str] = Field(default_factory=list)
    composio_api_key: str = Field(default="", json_schema_extra={"writeOnly": True})
    model_api_key_configured: bool = False
    composio_api_key_configured: bool = False
    default_model: str = "gpt-5-mini"
    theme: str = "dark"
    computer_connection: Literal["deployment", "windows"] = "deployment"
    computer_remote_url: str = ""
    computer_remote_token: str = Field(default="", max_length=4096, json_schema_extra={"writeOnly": True})
    computer_remote_token_configured: bool = False

    @field_validator("computer_remote_url")
    @classmethod
    def validate_computer_url(cls, value):
        value = value.strip().rstrip("/")
        if value:
            parsed = urlsplit(value)
            if not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
                raise ValueError("Enter the Windows agent origin without credentials or a path.")
            if parsed.scheme != "https" and not (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost", "::1"}):
                raise ValueError("Use HTTPS for a remote Windows agent, or HTTP on localhost.")
        return value

    @field_validator("model_api_base_url")
    @classmethod
    def validate_provider_url(cls, value):
        value = value.strip().rstrip("/")
        if value:
            parsed = urlsplit(value)
            if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
                raise ValueError("Use an http(s) API base URL without credentials, query parameters, or fragments.")
        return value

    @field_validator("model_api_headers")
    @classmethod
    def validate_provider_headers(cls, value):
        seen = set()
        for name, content in value.items():
            if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name) or any(ord(c) < 32 or ord(c) > 126 for c in content):
                raise ValueError("Use valid HTTP header names and printable ASCII values.")
            if name.lower() in seen:
                raise ValueError("Header names must be unique (case-insensitive).")
            seen.add(name.lower())
        return value

    @field_validator("model_ids")
    @classmethod
    def normalize_model_ids(cls, value):
        return list(dict.fromkeys(model.strip() for model in value if model.strip()))

    @field_validator("default_model")
    @classmethod
    def validate_default_model(cls, value):
        if not value.strip():
            raise ValueError("Enter a default model ID.")
        return value.strip()
