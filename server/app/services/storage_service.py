"""Durable local storage for bots, conversations, approvals, audit, and settings."""

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.config import settings
from app.services.auth_service import LOCAL_USER_ID
from app.services.database import Database
from app.services.secret_store import SecretStore, SecretStoreError


SECRET_KEYS = {"computer_remote_token", "model_api_key", "model_api_headers", "composio_api_key", "composio_key"}
SETTING_KEYS = {
    "computer_connection", "computer_remote_url", "computer_remote_token",
    "model_api_key",
    "model_api_base_url",
    "model_api_wire_api",
    "model_api_headers",
    "model_ids",
    "composio_api_key",
    "composio_key",
    "default_model",
    "theme",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class StorageService:
    """SQLite-backed storage with a one-time import from the legacy JSON files."""

    def __init__(self, data_dir: Optional[Path] = None):
        self.data_dir = (data_dir or settings.DATA_DIR).expanduser().resolve()
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.owner_id = LOCAL_USER_ID

        # Keep these paths for the one-time migration and as human-readable
        # recovery copies. Normal reads and writes use SQLite below.
        self.bots_file = self.data_dir / "bots.json"
        self.messages_file = self.data_dir / "messages.json"
        self.settings_file = self.data_dir / "settings.json"
        self.approvals_file = self.data_dir / "approvals.json"
        self.audit_file = self.data_dir / "audit.json"

        # Reuse an existing workspace in place so running clients do not split data.
        legacy_database = self.data_dir / "open-dots.sqlite3"
        self.db_path = legacy_database if legacy_database.exists() else self.data_dir / "poka.sqlite3"
        self.database = Database(self.db_path)
        self.secret_store = SecretStore(self.data_dir)
        self._migrate_legacy_json()
        self._ensure_defaults()
        self._migrate_poka_brand()

    def _migrate_poka_brand(self) -> None:
        # Normalize old product persona names without changing IDs or chat history.
        with self.database.connect() as connection:
            for row in connection.execute("SELECT id, payload FROM bots").fetchall():
                bot = json.loads(row['payload'])
                if bot.get('name', '').strip().lower() in {'open dots assistant', 'open dots', 'opendots assistant', 'dots assistant'}:
                    bot['name'] = 'Poka'
                    prompt = bot.get('system_prompt', '')
                    if prompt.startswith('You are Open Dots,'):
                        bot['system_prompt'] = prompt.replace('You are Open Dots,', 'You are Poka,', 1)
                    connection.execute("UPDATE bots SET payload=? WHERE id=?", (json.dumps(bot), row['id']))
            for row in connection.execute("SELECT id,payload FROM messages WHERE id='msg-welcome-1'").fetchall():
                message = json.loads(row['payload'])
                if message.get('text', '').startswith('Hello! I am **Open Dots Assistant**.'):
                    message['text'] = message['text'].replace('**Open Dots Assistant**', '**Poka**', 1)
                    connection.execute("UPDATE messages SET payload=? WHERE id=?", (json.dumps(message), row['id']))

    @staticmethod
    def _default_settings() -> Dict[str, Any]:
        return {
            "model_api_key": settings.MODEL_API_KEY,
            "model_api_base_url": settings.MODEL_API_BASE_URL,
            "model_api_wire_api": "prediction",
            "model_api_headers": {},
            "model_ids": [],
            "composio_api_key": settings.COMPOSIO_API_KEY,
            "default_model": settings.DEFAULT_MODEL,
            "theme": "dark",
        }

    @staticmethod
    def _write_json(path: Path, data: Any):
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w", encoding="utf-8") as file:
            json.dump(data, file, indent=2)

    @staticmethod
    def _read_json(path: Path, default: Any):
        try:
            with open(path, "r", encoding="utf-8") as file:
                return json.load(file)
        except Exception:
            return default

    def _count(self, table: str) -> int:
        if table not in {
            "bots",
            "messages",
            "settings",
            "approvals",
            "audit_events",
        }:
            raise ValueError(f"Unsupported storage table: {table}")
        with self.database.connect() as connection:
            row = connection.execute(
                f"SELECT COUNT(*) FROM {table} WHERE owner_id = ?", (self.owner_id,)
            ).fetchone()
        return int(row[0])

    @staticmethod
    def _decode_payload(payload: str) -> Optional[Any]:
        try:
            return json.loads(payload)
        except (TypeError, json.JSONDecodeError):
            return None

    def _migrate_legacy_json(self) -> None:
        if self.database.get_meta("legacy_json_imported") == "1":
            return

        legacy_bots = self._read_json(self.bots_file, [])
        if self._count("bots") == 0 and isinstance(legacy_bots, list) and legacy_bots:
            self.save_bots(legacy_bots)

        legacy_messages = self._read_json(self.messages_file, [])
        if (
            self._count("messages") == 0
            and isinstance(legacy_messages, list)
            and legacy_messages
        ):
            self.save_messages(legacy_messages)

        legacy_settings = self._read_json(self.settings_file, {})
        if (
            self._count("settings") == 0
            and isinstance(legacy_settings, dict)
            and legacy_settings
        ):
            self.save_settings(legacy_settings)

        legacy_approvals = self._read_json(self.approvals_file, [])
        if (
            self._count("approvals") == 0
            and isinstance(legacy_approvals, list)
            and legacy_approvals
        ):
            for approval in legacy_approvals:
                if isinstance(approval, dict):
                    self.add_approval(approval)

        legacy_audit = self._read_json(self.audit_file, [])
        if (
            self._count("audit_events") == 0
            and isinstance(legacy_audit, list)
            and legacy_audit
        ):
            for event in legacy_audit:
                if isinstance(event, dict):
                    self.add_audit_event(event)

        # The old settings file may contain plaintext credentials. Retain it
        # as a migration copy, but scrub only the credential fields after the
        # encrypted database copy has been written.
        if isinstance(legacy_settings, dict) and self.settings_file.exists():
            sanitized_settings = dict(legacy_settings)
            for key in SECRET_KEYS:
                if key in sanitized_settings:
                    sanitized_settings[key] = ""
            self._write_json(self.settings_file, sanitized_settings)
            os.chmod(self.settings_file, 0o600)

        for legacy_file in (
            self.bots_file,
            self.messages_file,
            self.approvals_file,
            self.audit_file,
        ):
            if legacy_file.exists():
                os.chmod(legacy_file, 0o600)

        self.database.set_meta("legacy_json_imported", "1")

    def _ensure_defaults(self) -> None:
        if self._count("bots") == 0:
            self.save_bots(
                [
                    {
                        "id": "bot-poka-1",
                        "name": "Poka",
                        "role": "Real-time Reasoning & Intelligence",
                        "description": "A general-purpose assistant for research, planning, and everyday work.",
                        "avatar": "🚀",
                        "model": "gpt-5-mini",
                        "accent_color": "#3b82f6",
                        "system_prompt": "You are Poka, a capable and careful AI assistant. Be direct, helpful, and clear about uncertainty.",
                        "tools": ["web_search", "code_interpreter", "computer_preview"],
                        "pinned": True,
                        "unread_count": 0,
                        "created_at": datetime.now().isoformat(),
                    },
                    {
                        "id": "bot-claude-1",
                        "name": "Claude Architect",
                        "role": "Full-Stack Code & Refactoring",
                        "description": "Specialized in software design, clean architectural patterns, and elegant React/Next.js code.",
                        "avatar": "⚡",
                        "model": "claude-sonnet-4-5",
                        "accent_color": "#d97757",
                        "system_prompt": "You are Claude Architect, an expert software engineer. Write clean, modular, modern code.",
                        "tools": ["file_editor", "terminal"],
                        "pinned": True,
                        "unread_count": 0,
                        "created_at": datetime.now().isoformat(),
                    },
                    {
                        "id": "bot-codex-1",
                        "name": "Codex Builder",
                        "role": "Automated Execution & Workflows",
                        "description": "Executes shell tasks, runs automated builds, and manages local computer environment.",
                        "avatar": "💻",
                        "model": "gpt-5-mini",
                        "accent_color": "#10b981",
                        "system_prompt": "You are Codex Builder, a devops and execution specialist. Help run commands safely.",
                        "tools": ["terminal", "approval_broker"],
                        "pinned": False,
                        "unread_count": 0,
                        "created_at": datetime.now().isoformat(),
                    },
                    {
                        "id": "bot-supa-1",
                        "name": "Connector Assistant",
                        "role": "General Assistant & App Connector",
                        "description": "Friendly assistant connected to the app marketplace (Slack, Gmail, GitHub).",
                        "avatar": "🐭",
                        "model": "gpt-5-mini",
                        "accent_color": "#a855f7",
                        "system_prompt": "You are a super-powered assistant. Be friendly, fast, and proactive.",
                        "tools": ["composio_apps", "dictation"],
                        "pinned": False,
                        "unread_count": 0,
                        "created_at": datetime.now().isoformat(),
                    },
                ]
            )

        if self._count("messages") == 0:
            self.save_messages(
                [
                    {
                        "id": "msg-welcome-1",
                        "thread_id": "bot-poka-1",
                        "bot_id": "bot-poka-1",
                        "sender": "bot",
                        "text": "Hello! I am **Poka**. Ask me a question or tell me what you would like to work on.",
                        "created_at": datetime.now().isoformat(),
                        "model": "gpt-5-mini",
                        "item_type": "assistant_text",
                    }
                ]
            )

        if self._count("settings") == 0:
            self.save_settings(self._default_settings())

    def get_bots(self) -> List[Dict[str, Any]]:
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT payload FROM bots WHERE owner_id = ? ORDER BY rowid",
                (self.owner_id,),
            ).fetchall()
        return [payload for row in rows if isinstance((payload := self._decode_payload(row[0])), dict)]

    def save_bots(self, bots: List[Dict[str, Any]]):
        with self.database.connect() as connection:
            connection.execute("DELETE FROM bots WHERE owner_id = ?", (self.owner_id,))
            for bot in bots:
                if not isinstance(bot, dict) or not bot.get("id"):
                    continue
                connection.execute(
                    "INSERT OR REPLACE INTO bots(id, owner_id, payload) VALUES (?, ?, ?)",
                    (str(bot["id"]), self.owner_id, json.dumps(bot)),
                )

    def delete_bot(self, bot_id: str) -> None:
        """Delete one bot without rewriting a stale snapshot of other bots."""
        with self.database.connect() as connection:
            connection.execute(
                "DELETE FROM bots WHERE owner_id = ? AND id = ?",
                (self.owner_id, bot_id),
            )

    def get_messages(self, thread_id: Optional[str] = None) -> List[Dict[str, Any]]:
        with self.database.connect() as connection:
            if thread_id:
                rows = connection.execute(
                    "SELECT payload FROM messages WHERE owner_id = ? AND thread_id = ? ORDER BY rowid",
                    (self.owner_id, thread_id),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT payload FROM messages WHERE owner_id = ? ORDER BY rowid",
                    (self.owner_id,),
                ).fetchall()
        return [payload for row in rows if isinstance((payload := self._decode_payload(row[0])), dict)]

    def add_message(self, message: Dict[str, Any]):
        if not isinstance(message, dict):
            return
        message_id = str(message.get("id") or f"msg-{uuid.uuid4().hex}")
        thread_id = str(message.get("thread_id") or "")
        with self.database.connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO messages(id, thread_id, owner_id, payload) VALUES (?, ?, ?, ?)",
                (message_id, thread_id, self.owner_id, json.dumps(message)),
            )

    def save_messages(self, messages: List[Dict[str, Any]]):
        with self.database.connect() as connection:
            connection.execute("DELETE FROM messages WHERE owner_id = ?", (self.owner_id,))
            for message in messages:
                if not isinstance(message, dict):
                    continue
                message_id = str(message.get("id") or f"msg-{uuid.uuid4().hex}")
                thread_id = str(message.get("thread_id") or "")
                connection.execute(
                    "INSERT OR REPLACE INTO messages(id, thread_id, owner_id, payload) VALUES (?, ?, ?, ?)",
                    (message_id, thread_id, self.owner_id, json.dumps(message)),
                )

    def get_settings(self) -> Dict[str, Any]:
        values = self._default_settings()
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT key, value, is_secret FROM settings WHERE owner_id = ? ORDER BY key",
                (self.owner_id,),
            ).fetchall()

        for row in rows:
            key, raw_value, is_secret = row
            if is_secret:
                try:
                    decrypted = self.secret_store.decrypt(raw_value)
                    values[key] = json.loads(decrypted) if key == "model_api_headers" else decrypted
                except SecretStoreError:
                    # A rotated or missing key should not prevent the app from
                    # starting. The user can replace the unavailable secret.
                    values[key] = {} if key == "model_api_headers" else ""
                continue
            decoded = self._decode_payload(raw_value)
            values[key] = raw_value if decoded is None else decoded
        return values

    def get_public_settings(self) -> Dict[str, Any]:
        values = self.get_settings()
        for key in SECRET_KEYS:
            values[f"{key}_configured"] = bool(values.get(key))
            values[key] = {} if key == "model_api_headers" else ""
        return values

    def save_settings(self, data: Dict[str, Any]):
        if not isinstance(data, dict):
            return
        with self.database.connect() as connection:
            if data.get("clear_model_api_headers"):
                connection.execute(
                    "DELETE FROM settings WHERE owner_id = ? AND key = 'model_api_headers'",
                    (self.owner_id,),
                )
            for key in SETTING_KEYS.intersection(data):
                value = data[key]
                if key in SECRET_KEYS:
                    # An empty write is the UI's "keep existing value" signal.
                    if value is None or value == {} or str(value).strip() == "":
                        continue
                    secret_value = json.dumps(value) if key == "model_api_headers" else str(value)
                    stored_value = self.secret_store.encrypt(secret_value)
                    is_secret = 1
                else:
                    stored_value = json.dumps(value)
                    is_secret = 0
                connection.execute(
                    "INSERT INTO settings(key, owner_id, value, is_secret) VALUES (?, ?, ?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET owner_id = excluded.owner_id, "
                    "value = excluded.value, is_secret = excluded.is_secret",
                    (key, self.owner_id, stored_value, is_secret),
                )

    def get_approvals(self, thread_id: Optional[str] = None) -> List[Dict[str, Any]]:
        with self.database.connect() as connection:
            if thread_id:
                rows = connection.execute(
                    "SELECT payload FROM approvals WHERE owner_id = ? AND thread_id = ? ORDER BY rowid",
                    (self.owner_id, thread_id),
                ).fetchall()
            else:
                rows = connection.execute(
                    "SELECT payload FROM approvals WHERE owner_id = ? ORDER BY rowid",
                    (self.owner_id,),
                ).fetchall()
        return [payload for row in rows if isinstance((payload := self._decode_payload(row[0])), dict)]

    def add_approval(self, approval: Dict[str, Any]):
        if not isinstance(approval, dict) or not approval.get("request_id"):
            return
        with self.database.connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO approvals(request_id, thread_id, owner_id, payload) VALUES (?, ?, ?, ?)",
                (
                    str(approval["request_id"]),
                    approval.get("thread_id"),
                    self.owner_id,
                    json.dumps(approval),
                ),
            )

    def update_approval(self, request_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT payload FROM approvals WHERE owner_id = ? AND request_id = ?",
                (self.owner_id, request_id),
            ).fetchone()
            if not row:
                return None
            approval = self._decode_payload(row[0])
            if not isinstance(approval, dict):
                return None
            approval.update(updates)
            connection.execute(
                "UPDATE approvals SET thread_id = ?, owner_id = ?, payload = ? "
                "WHERE owner_id = ? AND request_id = ?",
                (
                    approval.get("thread_id"),
                    self.owner_id,
                    json.dumps(approval),
                    self.owner_id,
                    request_id,
                ),
            )
        return approval

    def get_audit_events(self, limit: int = 100) -> List[Dict[str, Any]]:
        bounded_limit = max(1, min(limit, 500))
        with self.database.connect() as connection:
            rows = connection.execute(
                "SELECT payload FROM audit_events WHERE owner_id = ? ORDER BY id DESC LIMIT ?",
                (self.owner_id, bounded_limit),
            ).fetchall()
        return [
            payload
            for row in reversed(rows)
            if isinstance((payload := self._decode_payload(row[0])), dict)
        ]

    def add_audit_event(self, event: Dict[str, Any]):
        if not isinstance(event, dict):
            return
        created_at = str(event.get("created_at") or _now())
        with self.database.connect() as connection:
            connection.execute(
                "INSERT INTO audit_events(created_at, owner_id, payload) VALUES (?, ?, ?)",
                (created_at, self.owner_id, json.dumps(event)),
            )


storage_service = StorageService()
