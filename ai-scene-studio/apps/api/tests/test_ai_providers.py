"""Fournisseurs IA sans service externe : capacités, coûts, Claude avec un exécutable factice."""

import json
import stat
import subprocess
from pathlib import Path

import pytest

from ass_api.ai.capabilities import GenerationRequest, match_capabilities
from ass_api.ai.providers.base import ProviderError, RunContext
from ass_api.ai.providers.claude import ClaudeProvider
from ass_api.ai.providers.higgsfield import HiggsfieldBridgeProvider
from ass_api.ai.shot_frames import first_frame, graduated_image, image_size


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


def test_motion_video_models_are_priced_per_second() -> None:
    provider = HiggsfieldBridgeProvider("/nope")

    def cost(model: str, **options: str | bool) -> float:
        request = GenerationRequest("image_to_video", "x", duration_seconds=5, options=options)
        return provider.estimate_cost(model, request).amount

    assert cost("genjutsu_lite") == 10
    assert cost("kling4_0") == 13.75
    assert cost("kling4_0", resolution="1080p") == 20
    assert cost("seedance_2_5", resolution="720p") == 35
    # L'ancienne option « draft » reste comprise : 1080p au tarif relevé.
    assert cost("seedance_2_5", draft=False) == 80
    for model in ("genjutsu_lite", "kling4_0", "seedance_2_5"):
        assert "camera_motion" in provider.capabilities_for(model).controls


def test_motion_video_job_goes_to_the_motion_script(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    provider = HiggsfieldBridgeProvider(str(tmp_path))
    monkeypatch.setattr(provider, "availability", lambda: (True, ""))
    image = tmp_path / "image.png"
    image.write_bytes(b"png")
    request = GenerationRequest("image_to_video", "Recreate @video1", duration_seconds=5)
    with pytest.raises(ProviderError) as missing:
        provider.submit_generation("genjutsu_lite", request, _context(tmp_path, [image]))
    assert missing.value.code == "invalid_request"

    result = tmp_path / "result.mp4"
    result.write_bytes(b"mp4")
    seen: dict[str, object] = {}

    def fake_run(command: list[str], **_: object) -> subprocess.CompletedProcess[str]:
        seen["script"] = command[1]
        seen["job"] = json.loads(Path(command[2]).read_text(encoding="utf-8"))
        line = json.dumps({"ok": True, "id": "j1", "cost": 0, "url": result.as_uri()})
        return subprocess.CompletedProcess(command, 0, stdout=line + "\n", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    context = _context(tmp_path, [image])
    context.motion_video = tmp_path / "gris.mp4"
    provider.submit_generation("genjutsu_lite", request, context)
    outputs = provider.retrieve_outputs("j1", context)
    assert str(seen["script"]).endswith("workers/ai-worker/higgsfield/motion.mjs")
    job = seen["job"]
    assert isinstance(job, dict)
    assert job["model"] == "genjutsu_lite" and job["resolution"] == "720p"
    assert job["video"] == {"path": str(context.motion_video)}
    assert job["images"] == [{"path": str(image)}]
    assert job["free"] is True and job["max_cost"] == 10
    assert outputs[0].kind == "video" and outputs[0].metadata["actualCost"] == 0


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


def test_gpt_image_1k_is_announced_at_its_ceiling() -> None:
    provider = HiggsfieldBridgeProvider("/nope")
    cout = provider.estimate_cost(
        "gpt_image_2_5", GenerationRequest("text_to_image", "x", options={"resolution": "1k"})
    )
    assert cout.amount == 3
    assert "1K" in cout.basis


@pytest.mark.integration
def test_first_frame_of_a_real_video(tmp_path: Path) -> None:
    video = tmp_path / "plan.mp4"
    subprocess.run(  # noqa: S603
        [  # noqa: S607
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=1920x1080:rate=24:duration=1",
            "-pix_fmt",
            "yuv420p",
            str(video),
        ],
        check=True,
    )
    image = first_frame("ffmpeg", video, tmp_path / "plan.png")
    assert image.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    assert image_size("ffmpeg", image) == (1280, 720)
    grille = graduated_image("ffmpeg", image, tmp_path / "grille.png", (1280, 720))
    assert grille.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    (tmp_path / "abime.mp4").write_bytes(b"pas une video")
    with pytest.raises(ProviderError):
        first_frame("ffmpeg", tmp_path / "abime.mp4", tmp_path / "abime.png")


def test_claude_plateau_gets_image_size(tmp_path: Path) -> None:
    result = {"summary": "ok", "notes": "", "camera": {}, "elements": [], "lumieres": []}
    answer = tmp_path / "answer.json"
    answer.write_text(json.dumps({"is_error": False, "structured_output": result}))
    script = tmp_path / "fake-claude"
    script.write_text(
        "#!/usr/bin/env python3\n"
        "import sys\n"
        "open('prompt.txt', 'w').write(sys.argv[2])\n"
        f"print(open({str(answer)!r}).read())\n"
    )
    script.chmod(0o755)
    work = tmp_path / "work"
    work.mkdir()
    image = tmp_path / "a.png"
    image.write_bytes(b"\x89PNG")
    context = _context(work, [image])
    context.documents = {"image.json": json.dumps({"largeur": 1024, "hauteur": 576})}
    _external, outputs = ClaudeProvider(str(script), "secret").run(
        "sonnet", GenerationRequest("scene_from_shot", ""), context
    )
    assert outputs[0].data == result
    prompt = (work / "prompt.txt").read_text()
    assert "1024 x 576" in prompt
    assert "grille" in prompt
