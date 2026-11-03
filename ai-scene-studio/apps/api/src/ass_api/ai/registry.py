"""Registre des fournisseurs ; une file par fournisseur, servie par le worker qui en a la charge."""

from functools import cache

from ass_api.ai.providers.base import ProviderAdapter
from ass_api.ai.providers.claude import ClaudeProvider
from ass_api.ai.providers.higgsfield import HiggsfieldBridgeProvider
from ass_api.ai.providers.simulation import SimulationProvider
from ass_api.core.config import Settings


def build_providers(settings: Settings) -> dict[str, ProviderAdapter]:
    token = (
        settings.claude_code_oauth_token.get_secret_value()
        if settings.claude_code_oauth_token
        else None
    )
    providers: list[ProviderAdapter] = [
        SimulationProvider(settings.ffmpeg_path),
        ClaudeProvider(settings.claude_path, token),
        HiggsfieldBridgeProvider(settings.higgsfield_scripts_dir),
    ]
    return {provider.id: provider for provider in providers}


@cache
def default_providers() -> dict[str, ProviderAdapter]:
    from ass_api.core.config import get_settings

    return build_providers(get_settings())


def queue_key(settings: Settings, provider: str) -> str:
    return f"{settings.ai_queue_prefix}:{provider}"
