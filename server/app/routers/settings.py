from fastapi import APIRouter, HTTPException
from typing import Dict, Any
import httpx
from app.config import settings
from app.schemas.contracts import AppSettingsSchema
from app.services.storage_service import storage_service

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])

@router.get("", response_model=AppSettingsSchema)
async def get_settings():
    data = storage_service.get_public_settings()
    return AppSettingsSchema(**data)

@router.post("", response_model=AppSettingsSchema)
async def save_settings(new_settings: AppSettingsSchema):
    payload = new_settings.model_dump(exclude_unset=True)
    existing = storage_service.get_settings()
    if payload.get("computer_connection", existing.get("computer_connection")) == "windows":
        if not payload.get("computer_remote_url", existing.get("computer_remote_url")) or not (payload.get("computer_remote_token") or existing.get("computer_remote_token")):
            raise HTTPException(400, "Enter the Windows agent address and access token first.")
    connection_keys = {"computer_connection", "computer_remote_url", "computer_remote_token"}
    changed = any(key in payload and payload[key] != existing.get(key) and (key != "computer_remote_token" or payload[key]) for key in connection_keys)
    if changed:
        from app.services.computer_provider import computer_provider
        if computer_provider.has_active_computers():
            raise HTTPException(409, "Stop running computers before changing the connection.")
    storage_service.save_settings(payload)
    return AppSettingsSchema(**storage_service.get_public_settings())


@router.post("/test")
async def test_provider():
    """Read the saved provider's model catalog without a billable chat request."""
    config = storage_service.get_settings()
    base_url = (config.get("model_api_base_url") or settings.MODEL_API_BASE_URL).rstrip("/")
    if not base_url:
        raise HTTPException(400, "Save an API base URL first.")
    protocol = config.get("model_api_wire_api", "prediction")
    key = config.get("model_api_key") or settings.MODEL_API_KEY
    headers = {**(config.get("model_api_headers") or {}), "Accept": "application/json"}
    if key:
        headers["x-api-key" if protocol == "prediction" else "Authorization"] = key if protocol == "prediction" else f"Bearer {key}"
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
            response = await client.get(f"{base_url}/models", headers=headers)
        if not response.is_success:
            raise HTTPException(400, f"Model catalog returned HTTP {response.status_code}. Check the endpoint, key, and whether this provider supports /models.")
        payload = response.json()
        entries = payload.get("data", []) if isinstance(payload, dict) else payload
        ids = [entry.get("id") for entry in entries if isinstance(entry, dict) and isinstance(entry.get("id"), str)] if isinstance(entries, list) else []
        if not ids:
            raise HTTPException(400, "The endpoint responded, but did not return a compatible model catalog. Chat support has not been verified.")
        selected = config.get("default_model") or settings.DEFAULT_MODEL
        return {"ok": True, "models": ids, "default_model_found": selected in ids,
                "message": "Connected. The selected model is listed." if selected in ids else "Connected, but the selected model was not listed. Check its exact ID."}
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, TypeError):
        raise HTTPException(400, "Could not read the provider model catalog. Check the URL and connection.")


@router.post("/computer/test")
async def test_windows_connection():
    config = storage_service.get_settings()
    if not config.get("computer_remote_url") or not config.get("computer_remote_token"):
        raise HTTPException(400, "Save a Windows agent address and token first.")
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=False) as client:
            response = await client.get(config["computer_remote_url"] + "/health", headers={"Authorization": "Bearer " + config["computer_remote_token"]})
        if response.status_code in {401,403}:
            raise HTTPException(400, "Windows agent rejected the access token.")
        if not response.is_success:
            raise HTTPException(400, f"Windows agent returned HTTP {response.status_code}.")
        payload = response.json()
        if not isinstance(payload, dict) or payload.get("platform") != "windows" or payload.get("service") != "poka-windows-agent":
            raise HTTPException(400, "This address is not a Poka Windows agent.")
        return {"ok": True, "desktop_available": bool(payload.get("desktop_available")), "account": str(payload.get("account", ""))[:160], "message": "Connected. Windows desktop is ready." if payload.get("desktop_available") else "Connected. Sign in to Windows and unlock the desktop to use display, browser, and input."}
    except HTTPException:
        raise
    except (httpx.HTTPError, ValueError, TypeError):
        raise HTTPException(400, "Cannot reach Windows agent. Check its HTTPS certificate, address, firewall, and running task.")
