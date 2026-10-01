from fastapi import APIRouter
from typing import List
from app.schemas.contracts import ModelInfo
from app.services.storage_service import storage_service

router = APIRouter(prefix="/api/v1/models", tags=["models"])

# Model IDs available through the configured inference endpoint.
AVAILABLE_MODELS: List[ModelInfo] = [
    # Claude Family
    ModelInfo(id="claude-sonnet-4-5", name="Claude 4.5 Sonnet", provider="Anthropic", description="Advanced code generation & refactoring agent", recommended=True),
    ModelInfo(id="claude-sonnet-4-6", name="Claude 4.6 Sonnet", provider="Anthropic", description="Flagship Anthropic model for enterprise workflows"),
    ModelInfo(id="claude-sonnet-5", name="Claude 5 Sonnet", provider="Anthropic", description="Next-generation Claude reasoning engine"),
    ModelInfo(id="claude-opus-4-5", name="Claude 4.5 Opus", provider="Anthropic", description="Ultra-complex reasoning & multi-turn problem solving"),
    ModelInfo(id="claude-opus-4-6", name="Claude 4.6 Opus", provider="Anthropic", description="Flagship Opus deep intelligence engine"),
    ModelInfo(id="claude-opus-4-7", name="Claude 4.7 Opus", provider="Anthropic", description="Extended reasoning Opus model"),
    ModelInfo(id="claude-opus-4-8", name="Claude 4.8 Opus", provider="Anthropic", description="Max-capacity Opus tier"),
    ModelInfo(id="claude-opus-5", name="Claude 5 Opus", provider="Anthropic", description="Next-gen flagship Opus intelligence"),
    ModelInfo(id="claude-haiku-4-5", name="Claude 4.5 Haiku", provider="Anthropic", description="Fast lightweight Anthropic model"),
    ModelInfo(id="claude-fable-5", name="Claude 5 Fable", provider="Anthropic", description="Creative & story generation specialist"),

    # Gemini Family
    ModelInfo(id="gemini-2-5-pro", name="Gemini 2.5 Pro", provider="Google", description="Deep context window & multimodal reasoning"),
    ModelInfo(id="gemini-2-5-flash", name="Gemini 2.5 Flash", provider="Google", description="Ultra-fast lightweight Google model"),
    ModelInfo(id="gemini-3-flash", name="Gemini 3 Flash", provider="Google", description="Next-gen Gemini 3 high-efficiency model"),
    ModelInfo(id="gemini-3-5-flash", name="Gemini 3.5 Flash", provider="Google", description="Enhanced speed & accuracy Gemini tier"),
    ModelInfo(id="gemini-3-5-flash-openai", name="Gemini 3.5 Flash (OpenAI Format)", provider="Google", description="Gemini 3.5 Flash with OpenAI schema compatibility"),
    ModelInfo(id="gemini-3-6-flash", name="Gemini 3.6 Flash", provider="Google", description="Latest 3.6 Flash iteration"),
    ModelInfo(id="gemini-3-6-flash-openai", name="Gemini 3.6 Flash (OpenAI Format)", provider="Google", description="Gemini 3.6 Flash OpenAI format"),
    ModelInfo(id="gemini-3-1-pro", name="Gemini 3.1 Pro", provider="Google", description="Pro-grade reasoning & structured output engine"),
    ModelInfo(id="gemini-3-pro", name="Gemini 3 Pro", provider="Google", description="Flagship Gemini 3 reasoning engine"),

    # GPT Family
    ModelInfo(id="gpt-5-mini", name="GPT 5 Mini", provider="OpenAI", description="Compact high-speed GPT-5 model", recommended=True),
    ModelInfo(id="gpt-5-nano", name="GPT 5 Nano", provider="OpenAI", description="Micro lightweight GPT-5 tier"),
    ModelInfo(id="gpt-5-2", name="GPT 5.2", provider="OpenAI", description="Next-gen GPT 5.2 intelligence tier"),
    ModelInfo(id="gpt-5-4", name="GPT 5.4", provider="OpenAI", description="Advanced GPT 5.4 model"),
    ModelInfo(id="gpt-5-5", name="GPT 5.5", provider="OpenAI", description="Flagship GPT 5.5 reasoning model"),
    ModelInfo(id="gpt-5-6-luna", name="GPT 5.6 Luna", provider="OpenAI", description="Specialized Luna variant of GPT 5.6"),
    ModelInfo(id="gpt-5-6-sol", name="GPT 5.6 Sol", provider="OpenAI", description="High-throughput Sol variant of GPT 5.6"),
    ModelInfo(id="gpt-5-6-terra", name="GPT 5.6 Terra", provider="OpenAI", description="Deep analysis Terra variant of GPT 5.6"),
    ModelInfo(id="gpt-codex", name="GPT Codex", provider="OpenAI", description="Code generation & refactoring specialist"),

    # DeepSeek & Kimi Family
    ModelInfo(id="deepseek-v4-pro", name="DeepSeek V4 Pro", provider="DeepSeek", description="Deep reasoning & mathematical intelligence engine"),
    ModelInfo(id="deepseek-v4-flash", name="DeepSeek V4 Flash", provider="DeepSeek", description="Fast open-weights deep reasoning engine"),
    ModelInfo(id="kimi-k3", name="Kimi K3", provider="Moonshot", description="Long-context Chinese & English reasoning model")
]

@router.get("", response_model=List[ModelInfo])
async def list_models():
    configured = storage_service.get_settings()
    if configured.get("model_ids"):
        return [
            ModelInfo(id=model_id, name=model_id, provider="Configured provider",
                      description="Model available from the configured inference service",
                      recommended=model_id == configured.get("default_model"))
            for model_id in configured["model_ids"]
        ]
    return AVAILABLE_MODELS
