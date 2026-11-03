"""Claude par l'abonnement (outil officiel `claude` en mode non interactif) : assistants texte.

Claude lit des images et produit du texte : il ne génère ni image ni vidéo. Modes : prompt de plan
à partir de la scène et de ses rendus, assistant de scène (consigne → opérations proposées) et
critique d'un rendu. Authentification : `CLAUDE_CODE_OAUTH_TOKEN` (jeton d'abonnement), jamais
exposé au navigateur. Seul l'outil de lecture de fichiers est autorisé, dans le dossier de travail.
"""

import json
import os
import shutil
import subprocess
import uuid
from typing import Any, Final

from ass_api.ai.capabilities import GenerationRequest, ModelCapabilities
from ass_api.ai.providers.base import (
    CostEstimate,
    ErrorCode,
    ProviderAdapter,
    ProviderError,
    ProviderOutput,
    RunContext,
)
from ass_api.ai.providers.claude_studio import STUDIO_MODES, studio_task

MODELS: Final = {"sonnet": "Claude Sonnet", "opus": "Claude Opus", "haiku": "Claude Haiku"}

PROMPT_SCHEMA: Final = {
    "type": "object",
    "properties": {
        "prompt": {
            "type": "string",
            "description": "Prompt de génération en anglais, prêt à l'emploi",
        },
        "negativePrompt": {"type": "string"},
        "subject": {"type": "string"},
        "camera": {"type": "string", "description": "Cadrage, focale, hauteur, mouvement"},
        "lighting": {"type": "string"},
        "notes": {"type": "string", "description": "Conseils en français pour l'utilisateur"},
    },
    "required": ["prompt", "negativePrompt", "subject", "camera", "lighting", "notes"],
}
OPERATION: Final = {
    "type": "object",
    "properties": {
        "op": {
            "type": "string",
            "enum": [
                "add_primitive",
                "add_camera",
                "add_light",
                "set_transform",
                "set_key",
                "delete",
                "rename",
                "set_color",
                "set_active_camera",
                "look_at",
            ],
        },
        "target": {
            "type": "string",
            "description": "Nom exact d'une entité existante ou créée plus haut",
        },
        "name": {"type": "string"},
        "primitive": {
            "type": "string",
            "enum": ["cube", "sphere", "cylinder", "plane", "cone", "torus"],
        },
        "lightKind": {"type": "string", "enum": ["directional", "point", "spot"]},
        "position": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "rotationDegrees": {
            "type": "array",
            "items": {"type": "number"},
            "minItems": 3,
            "maxItems": 3,
        },
        "scale": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "color": {
            "type": "array",
            "items": {"type": "number", "minimum": 0, "maximum": 1},
            "minItems": 3,
            "maxItems": 3,
            "description": "Couleur sRGB, composantes de 0 à 1",
        },
        "frame": {"type": "integer", "minimum": 0},
        "focalLengthMm": {"type": "number"},
        "lookAt": {"type": "string"},
    },
    "required": ["op"],
}
SCENE_SCHEMA: Final = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "Ce qui va être fait, en français"},
        "operations": {"type": "array", "items": OPERATION, "maxItems": 60},
    },
    "required": ["summary", "operations"],
}
ANALYSIS_SCHEMA: Final = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "strengths": {"type": "array", "items": {"type": "string"}},
        "issues": {"type": "array", "items": {"type": "string"}},
        "suggestions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "strengths", "issues", "suggestions"],
}

CONVENTIONS: Final = """\
Repère de la scène : main droite, Y vers le haut, -Z vers l'avant, unités en mètres ; angles en
degrés dans tes réponses. Une caméra d'orientation nulle regarde vers -Z. Le sol est y = 0 ; une
primitive unitaire (1 m) posée au sol a y = 0.5."""

PROMPT_TASK: Final = """\
Tu es directeur de la photographie et prompt engineer.
{conventions}

{scene}
{images}
Rédige le prompt (en anglais) d'un générateur d'images ou de vidéos qui doit respecter la
composition de la caméra active : cadrage, position des sujets, profondeur. Les images de rendu et
de profondeur montrent la composition à respecter.
Intention de l'utilisateur : {intent}"""

SCENE_TASK: Final = """\
Tu pilotes un éditeur 3D.
{conventions}

{scene}
Propose la liste d'opérations qui réalise la consigne, sans rien inventer d'autre. Désigne les
entités par leur nom exact ; positions en mètres, rotations en degrés (Euler XYZ). set_key pose une
clé de la transformation courante de la cible à la frame indiquée, après application des valeurs
données dans la même opération.
Consigne : {intent}"""

ANALYSIS_TASK: Final = """\
Tu es superviseur d'images.
{conventions}

{scene}
{images}
Analyse le rendu (premier fichier) au regard de la scène et des références éventuelles (fichiers
suivants). Réponds en français.
Question de l'utilisateur : {intent}"""


class ClaudeProvider(ProviderAdapter):
    id = "claude"
    label = "Claude (abonnement)"
    kind = "subscription"

    def __init__(self, executable: str, token: str | None, timeout_seconds: int = 600) -> None:
        self._executable = executable
        self._token = token
        self._timeout = timeout_seconds
        self._results: dict[str, list[ProviderOutput]] = {}

    def availability(self) -> tuple[bool, str]:
        if not shutil.which(self._executable):
            return False, "Outil claude introuvable sur ce worker"
        if not self._token:
            return False, "Jeton d'abonnement Claude absent (CLAUDE_CODE_OAUTH_TOKEN)"
        return True, ""

    def get_capabilities(self) -> list[ModelCapabilities]:
        return [
            ModelCapabilities(
                provider=self.id,
                model=model,
                label=label,
                modes=(
                    "prompt_from_scene",
                    "scene_from_text",
                    "image_analysis",
                    "script_breakdown",
                    "bible_from_script",
                    "shot_prompts",
                ),
                controls=("first_frame", "last_frame", "reference_images", "depth"),
                max_reference_images=8,
                notes="Lit les images et les documents, rédige ; ne génère ni image ni vidéo.",
            )
            for model, label in MODELS.items()
        ]

    def estimate_cost(self, model: str, request: GenerationRequest) -> CostEstimate:
        return CostEstimate(
            0, "abonnement", "Inclus dans l'abonnement Claude (quota d'usage)", paid=False
        )

    def _instructions(
        self, request: GenerationRequest, context: RunContext, files: list[str]
    ) -> tuple[str, dict[str, Any]]:
        if request.mode in STUDIO_MODES:
            documents = sorted(context.documents) + files
            return studio_task(request.mode, documents, context.brief, request.prompt)
        images = (
            "Images fournies dans le dossier courant (lis-les avec l'outil Read) : "
            + ", ".join(files)
            if files
            else "Aucune image fournie."
        )
        values = {
            "conventions": CONVENTIONS,
            "scene": f"Description de la scène 3D :\n{context.scene_summary}",
            "images": images,
            "intent": request.prompt or "(aucune précision)",
        }
        if request.mode == "prompt_from_scene":
            return PROMPT_TASK.format(**values), PROMPT_SCHEMA
        if request.mode == "scene_from_text":
            return SCENE_TASK.format(**values), SCENE_SCHEMA
        return ANALYSIS_TASK.format(**values), ANALYSIS_SCHEMA

    def submit_generation(self, model: str, request: GenerationRequest, context: RunContext) -> str:
        available, reason = self.availability()
        if not available:
            raise ProviderError("provider_unavailable", reason)
        files = []
        for index, path in enumerate(context.references):
            name = f"image_{index + 1}{path.suffix or '.png'}"
            shutil.copy(path, context.work / name)
            files.append(name)
        for name, content in context.documents.items():
            (context.work / name).write_text(content, encoding="utf-8")
        prompt, schema = self._instructions(request, context, files)
        config = context.work / ".claude-config"
        config.mkdir(exist_ok=True)
        env = {
            "PATH": os.environ.get("PATH", ""),
            "HOME": str(context.work),
            "CLAUDE_CONFIG_DIR": str(config),
            "CLAUDE_CODE_OAUTH_TOKEN": self._token or "",
        }
        command = [
            self._executable,
            "-p",
            prompt,
            "--model",
            model,
            "--output-format",
            "json",
            "--json-schema",
            json.dumps(schema),
            "--no-session-persistence",
            "--tools",
            "Read",
            "--allowedTools",
            "Read",
        ]
        task = {
            "script_breakdown": "découpe le film",
            "bible_from_script": "établit la bible",
            "shot_prompts": "écrit les prompts du plan",
        }.get(request.mode, "analyse la scène")
        context.progress(0.2, f"{MODELS.get(model, model)} {task}")
        try:
            result = subprocess.run(  # noqa: S603 (commande construite ici, sans shell)
                command,
                cwd=context.work,
                env=env,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=self._timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ProviderError(
                "timeout", "Claude n'a pas répondu à temps", retryable=True
            ) from exc
        try:
            payload = json.loads(result.stdout)
        except json.JSONDecodeError as exc:
            detail = (result.stdout + result.stderr)[-500:]
            if "401" in detail or "authentication" in detail.lower():
                raise ProviderError("authentication", "Jeton Claude refusé : à renouveler") from exc
            raise ProviderError(
                "provider_unavailable", "Réponse illisible de Claude", detail=detail
            ) from exc
        if payload.get("is_error") or not isinstance(payload.get("structured_output"), dict):
            text = str(payload.get("result", ""))[:300]
            if "safeguards" in text.lower() or "/aup" in text.lower():
                # Faux positifs connus des garde-fous sur des scripts de fiction ordinaires.
                raise ProviderError(
                    "content_policy",
                    f"{MODELS.get(model, model)} a refusé la demande (garde-fous) : "
                    "relancez, ou choisissez un autre modèle Claude",
                    retryable=True,
                    detail=text,
                )
            code: ErrorCode = "rate_limited" if "limit" in text.lower() else "unknown"
            raise ProviderError(
                code,
                f"Claude n'a pas produit de résultat exploitable : {text}",
                retryable=code == "rate_limited",
            )
        external_id = payload.get("session_id") or f"claude-{uuid.uuid4().hex[:12]}"
        self._results[external_id] = [
            ProviderOutput(
                "json",
                data=payload["structured_output"],
                metadata={"model": model, "turns": payload.get("num_turns")},
            )
        ]
        return str(external_id)

    def retrieve_outputs(self, external_id: str, context: RunContext) -> list[ProviderOutput]:
        return self._results.pop(external_id)
