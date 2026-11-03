"""Fournisseurs IA sans service externe : capacités, coûts, Claude avec un exécutable factice."""

import json
import stat
from pathlib import Path

import pytest

from ass_api.ai.capabilities import GenerationRequest, match_capabilities
from ass_api.ai.providers.base import ProviderError, RunContext
from ass_api.ai.providers.claude import ClaudeProvider
from ass_api.ai.providers.higgsfield import HiggsfieldBridgeProvider


def _context(tmp_path: Path, references: list[Path] | None = None) -> RunContext:
    return RunContext(
        work=tmp_path,
        references=references or [],
        scene_summary="Cube (0, 0.5, 0)",
        progress=lambda *_: False,
    )


def test_capability_matching_flags_unsupported_controls() -> None:
    caps = HiggsfieldBridgeProvider("/nope").capabilities_for("seedance_2_5")
    request = GenerationRequest(
        mode="image_to_video", prompt="x", controls=["depth"], reference_count=5, duration_seconds=7
    )
    found = {(m.field, m.severity) for m in match_capabilities(request, caps)}
    assert ("controls.depth", "ignored") in found
    assert ("referenceCount", "blocking") in found
    assert ("durationSeconds", "blocking") in found


def test_higgsfield_costs_and_availability(tmp_path: Path) -> None:
    provider = HiggsfieldBridgeProvider(str(tmp_path))
    assert (
        provider.estimate_cost("gpt_image_2_5", GenerationRequest("text_to_image", "x")).amount == 3
    )
    video = GenerationRequest("text_to_video", "x", duration_seconds=5)
    assert provider.estimate_cost("seedance_2_5", video).amount == 15
    available, reason = provider.availability()
    assert not available and "introuvables" in reason


def _fake_claude(tmp_path: Path, payload: dict[str, object]) -> str:
    script = tmp_path / "fake-claude"
    script.write_text(
        "#!/usr/bin/env python3\nimport json, sys, os\n"
        "assert os.environ['CLAUDE_CODE_OAUTH_TOKEN'] == 'secret'\n"
        "assert '--tools' in sys.argv and sys.argv[sys.argv.index('--tools') + 1] == 'Read'\n"
        f"print(json.dumps(json.loads({json.dumps(json.dumps(payload))})))\n",
        encoding="utf-8",
    )
    script.chmod(script.stat().st_mode | stat.S_IEXEC)
    return str(script)


def test_claude_structured_output(tmp_path: Path) -> None:
    result = {
        "summary": "ok",
        "operations": [{"op": "add_primitive", "primitive": "cube", "name": "A"}],
    }
    provider = ClaudeProvider(
        _fake_claude(
            tmp_path, {"is_error": False, "structured_output": result, "session_id": "s1"}
        ),
        "secret",
    )
    work = tmp_path / "work"
    work.mkdir()
    image = tmp_path / "rendu.png"
    image.write_bytes(b"\x89PNG")
    external, outputs = provider.run(
        "sonnet", GenerationRequest("scene_from_text", "ajoute un cube"), _context(work, [image])
    )
    assert external == "s1"
    assert outputs[0].data == result
    assert (work / "image_1.png").exists()


def test_claude_errors_are_normalized(tmp_path: Path) -> None:
    provider = ClaudeProvider(
        _fake_claude(tmp_path, {"is_error": True, "result": "usage limit reached"}), "secret"
    )
    with pytest.raises(ProviderError) as error:
        provider.run("sonnet", GenerationRequest("image_analysis", "?"), _context(tmp_path))
    assert error.value.code == "rate_limited"
    refused = {"is_error": True, "result": "API Error: safeguards flagged this message (/aup)"}
    with pytest.raises(ProviderError) as error:
        ClaudeProvider(_fake_claude(tmp_path, refused), "secret").run(
            "sonnet", GenerationRequest("script_breakdown", ""), _context(tmp_path)
        )
    assert error.value.code == "content_policy"
    assert "autre modèle Claude" in str(error.value)
    assert ClaudeProvider(_fake_claude(tmp_path, {}), None).availability() == (
        False,
        "Jeton d'abonnement Claude absent (CLAUDE_CODE_OAUTH_TOKEN)",
    )
