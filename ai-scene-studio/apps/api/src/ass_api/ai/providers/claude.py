"""Claude par l'abonnement (outil officiel `claude` en mode non interactif) : assistants texte.

Claude lit des images et produit du texte : il ne génère ni image ni vidéo. Modes : prompt de plan
à partir de la scène et de ses rendus, assistant de scène (consigne → opérations proposées), plateau
d'un plan (image graduée → éléments en pixels) et critique d'un rendu.
Authentification : `CLAUDE_CODE_OAUTH_TOKEN` (jeton d'abonnement), jamais exposé au navigateur.
Seul l'outil de lecture de fichiers est autorisé, dans le dossier de travail.
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
PIXEL: Final = {"type": "number", "description": "Pixels de l'image du plan"}
PLATEAU_SCHEMA: Final = {
    "type": "object",
    "properties": {
        "summary": {"type": "string", "description": "Le plateau construit, en français"},
        "notes": {"type": "string", "description": "Ce qui reste approximatif, en français"},
        "camera": {
            "type": "object",
            "properties": {
                "focaleMm": {"type": "number"},
                "hauteurM": {"type": "number", "description": "Hauteur de la caméra au sol"},
                "horizonY": {"type": "number", "description": "Ordonnée de l'horizon, en pixels"},
            },
            "required": ["focaleMm", "hauteurM", "horizonY"],
        },
        "couleurSol": {"type": "array", "items": {"type": "number"}, "minItems": 3, "maxItems": 3},
        "elements": {
            "type": "array",
            "maxItems": 70,
            "items": {
                "type": "object",
                "properties": {
                    "nom": {"type": "string"},
                    "forme": {"type": "string", "enum": ["boite", "boule", "cylindre", "plateau"]},
                    "x0": PIXEL,
                    "y0": PIXEL,
                    "x1": PIXEL,
                    "y1": PIXEL,
                    "distanceM": {"type": "number", "description": "Distance à la caméra"},
                    "profondeurM": {"type": "number", "description": "Épaisseur vers l'arrière"},
                    "couleur": {
                        "type": "array",
                        "items": {"type": "number"},
                        "minItems": 3,
                        "maxItems": 3,
                    },
                    "coins": {
                        "type": "array",
                        "description": "Plateau : ses 4 coins dans l'image, dans l'ordre du tour",
                        "items": {
                            "type": "array",
                            "items": {"type": "number"},
                            "minItems": 2,
                            "maxItems": 2,
                        },
                        "minItems": 4,
                        "maxItems": 4,
                    },
                    "hauteurM": {"type": "number", "description": "Plateau : hauteur au sol"},
                    "epaisseurM": {"type": "number"},
                    "jusquAuSol": {"type": "boolean"},
                },
                "required": ["nom", "forme", "couleur"],
            },
        },
    },
    "required": ["summary", "notes", "camera", "elements"],
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

SHOT_SCENE_TASK: Final = """\
Tu es chef décorateur. Tu construis le plateau gris d'un plan, comme sur un vrai tournage : une
pièce
en volumes simples et une doublure par personnage. Il servira de repère pour générer des images et
des vidéos, toujours avec le même placement. Vu de sa caméra, il doit se superposer à l'image.

Tu ne donnes aucune position en mètres dans la pièce : pour chaque élément, tu donnes sa place en
PIXELS dans l'image et sa distance à la caméra. Le calcul fait le reste : l'élément retombera
exactement
sur ces pixels. Sois donc précis sur les pixels ; une distance approximative n'a pas d'effet vu de
cette
caméra, mais elle en aura si la caméra bouge : garde les proportions réelles.

{images}
{documents}
L'image mesure {largeur} x {hauteur} pixels. Regarde les deux images avec l'outil Read : l'image du
plan, et la même avec une grille (un trait tous les 50 pixels, appuyé et gradué tous les 100).
Relève
chaque coordonnée sur la grille : ne l'estime pas de mémoire.

Méthode :
1. La caméra. horizonY : l'ordonnée de l'horizon (ligne de mer, point de fuite des lignes
   horizontales).
   Focale probable. hauteurM : déduite de ce qui est à hauteur d'œil dans l'image (ce qui croise
   l'horizon est à la hauteur de la caméra). Un visage adulte fait environ 0,24 m de haut ; un
   plateau de
   bureau est à 0,75 m ; une porte fait 2 m. À la focale f, un objet de H mètres à la distance d
   occupe
   H * f * {largeur} / (36 * d) pixels de haut : déduis-en les distances, en commençant par le
   sujet.
2. Le fond, du plus loin au plus près : ciel, mer, murs, fenêtre avec chaque montant, bibliothèque,
   cadres. Pour une vue extérieure, distanceM d'au moins 40.
3. Les meubles. Une table ou un bureau vus en perspective : forme « plateau », avec ses 4 coins dans
   l'image (coins, dans l'ordre du tour), sa hauteur réelle (hauteurM) et jusquAuSol si le meuble
   est
   plein. Les x0, y0, x1, y1 sont alors inutiles.
4. Chaque personnage : une doublure faite de volumes arrondis, nommés (« Femme - tête » en boule,
   « Femme - buste » en boule, « Femme - bras gauche », « Femme - jambes »), qui épousent sa
   silhouette. Jamais de boîte pour un corps. Les volumes de l'objet nommé par `forme` couvrent
   leur boîte
   de pixels : boule et cylindre s'y inscrivent.
5. Les objets qui comptent pour le cadre : lampe, bocal, casque… en boule, cylindre ou boîte.
6. L'avant-plan flou, en grandes masses.

Couleurs : la teinte moyenne de chaque élément, de 0 à 1, en restant simples. Noms en français,
uniques, de 30 à
60
éléments. Ne décris que ce qu'on voit. Précision de l'utilisateur : {intent}"""

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
                    "scene_from_shot",
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
        if request.mode == "scene_from_shot":
            mesure = json.loads(context.documents["image.json"])
            values["images"] = f"Images du plan, dans le dossier courant : {', '.join(files)}."
            autres = sorted(set(context.documents) - {"image.json"})
            values["documents"] = (
                f"Fiches du plan et de la bible, à lire aussi : {', '.join(autres)}."
                if autres
                else ""
            )
            values["largeur"] = mesure["largeur"]
            values["hauteur"] = mesure["hauteur"]
            return SHOT_SCENE_TASK.format(**values), PLATEAU_SCHEMA
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
            "scene_from_shot": "bâtit le plateau du plan",
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
