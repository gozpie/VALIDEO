"""Higgsfield par passerelle navigateur (NON OFFICIELLE) sur l'abonnement du compte connecté.

L'API publique de Higgsfield est un produit distinct (clé et solde prépayé en dollars) : elle ne
consomme pas les crédits d'un abonnement. Cette passerelle réutilise les scripts de VALIDEO qui
appellent l'API interne du site depuis l'onglet Higgsfield ouvert dans Chrome (port de débogage
9222, compte connecté) : elle ne tourne que sur le Mac où Chrome est ouvert, et l'API interne peut
changer sans préavis. Chaque génération consomme des crédits : l'API exige de confirmer le coût.

Coûts relevés (crédits affichés ; l'API interne renvoie des centièmes) : GPT Image 2.5 en 2k = 3 cr
par image ; Seedance 2.5 = 3 cr/s en 480p, 7 cr/s en 720p, 16 cr/s en 1080p (table du 07/11/2026).

Vidéo de mouvement (vidéo grise du plateau) : Genjutsu Lite, Seedance 2.5 et Kling 4.0 reprennent
sa caméra, ses places et son rythme (`workers/ai-worker/higgsfield/motion.mjs`). Avant de lancer,
ce script demande le devis du site et s'arrête s'il dépasse le montant confirmé.
"""

import json
import shutil
import subprocess
import urllib.request
from pathlib import Path
from typing import Final, Literal

from ass_api.ai.capabilities import GenerationRequest, ModelCapabilities
from ass_api.ai.providers.base import (
    CostEstimate,
    ErrorCode,
    ProviderAdapter,
    ProviderError,
    ProviderOutput,
    RunContext,
)

ASPECTS: Final = ("16:9", "9:16", "1:1", "4:3", "3:4", "21:9")
SIZES: Final = {
    "16:9": (2560, 1440),
    "9:16": (1440, 2560),
    "1:1": (2048, 2048),
    "4:3": (2304, 1728),
    "3:4": (1728, 2304),
    "21:9": (3168, 1344),
}
SIZES_1K: Final = {
    "16:9": (1280, 720),
    "9:16": (720, 1280),
    "1:1": (1024, 1024),
    "4:3": (1152, 864),
    "3:4": (864, 1152),
    "21:9": (1344, 576),
}
IMAGE_SCRIPT: Final = "generate_higgsfield_image_api.mjs"
VIDEO_SCRIPT: Final = "generate_higgsfield_seedance_api.mjs"
MOTION_SCRIPT: Final = (
    Path(__file__).resolve().parents[6] / "workers" / "ai-worker" / "higgsfield" / "motion.mjs"
)
VIDEO_MODELS: Final = frozenset({"seedance_2_5", "genjutsu_lite", "kling4_0"})
# Crédits par seconde selon la définition (table des coûts du site, 07/11/2026).
RATES: Final = {
    "seedance_2_5": {"480p": 3.0, "720p": 7.0, "1080p": 16.0},
    "genjutsu_lite": {"720p": 2.0, "1080p": 4.0},
    # Kling 4.0 avec une vidéo de référence ; sans vidéo : 2,25 et 3,25.
    "kling4_0": {"720p": 2.75, "1080p": 4.0},
}
DEFAULT_RESOLUTION: Final = {"seedance_2_5": "480p", "genjutsu_lite": "720p", "kling4_0": "720p"}
MOTION_SIZES: Final = {
    "480p": {"16:9": (854, 480), "9:16": (480, 854), "1:1": (480, 480)},
    "720p": {"16:9": (1280, 720), "9:16": (720, 1280), "1:1": (720, 720)},
    "1080p": {"16:9": (1920, 1080), "9:16": (1080, 1920), "1:1": (1080, 1080)},
}
LABELS: Final = {
    "seedance_2_5": "Seedance 2.5",
    "genjutsu_lite": "Genjutsu Lite",
    "kling4_0": "Kling 4.0",
}


def video_resolution(model: str, request: GenerationRequest) -> str:
    """Définition demandée (option `resolution`), ou l'ancienne option `draft` de Seedance."""
    wanted = request.options.get("resolution")
    if isinstance(wanted, str) and wanted in RATES[model]:
        return wanted
    if model == "seedance_2_5" and "draft" in request.options:
        return "480p" if request.options["draft"] else "1080p"
    return DEFAULT_RESOLUTION[model]


class HiggsfieldBridgeProvider(ProviderAdapter):
    id = "higgsfield"
    label = "Higgsfield — passerelle navigateur (non officielle)"
    kind = "bridge"

    def __init__(
        self, scripts_dir: str, node: str = "node", cdp_url: str = "http://127.0.0.1:9222"
    ) -> None:
        self._dir = Path(scripts_dir).expanduser()
        self._node = node
        self._cdp = cdp_url
        self._results: dict[str, list[ProviderOutput]] = {}

    def availability(self) -> tuple[bool, str]:
        if not (self._dir / IMAGE_SCRIPT).exists():
            return False, f"Scripts Higgsfield introuvables ({self._dir})"
        if not shutil.which(self._node):
            return False, "Node.js introuvable sur ce worker"
        try:
            with urllib.request.urlopen(f"{self._cdp}/json/list", timeout=2) as response:  # noqa: S310
                tabs = json.loads(response.read())
        except OSError:
            return False, "Chrome n'est pas joignable (port de débogage 9222)"
        if not any("higgsfield" in str(tab.get("url", "")) for tab in tabs):
            return False, "Aucun onglet higgsfield.ai ouvert dans Chrome"
        return True, ""

    def get_capabilities(self) -> list[ModelCapabilities]:
        return [
            ModelCapabilities(
                provider=self.id,
                model="gpt_image_2_5",
                label="GPT Image 2.5 (Sunburst)",
                modes=("text_to_image", "image_to_image"),
                controls=("reference_images",),
                max_reference_images=8,
                max_width=3168,
                max_height=2560,
                aspect_ratios=ASPECTS,
                notes="Références : style et composition ; pas de carte de profondeur.",
            ),
            ModelCapabilities(
                provider=self.id,
                model="seedance_2_5",
                label="Seedance 2.5",
                modes=("text_to_video", "image_to_video"),
                controls=("reference_images", "camera_motion"),
                max_reference_images=4,
                max_width=1920,
                max_height=1920,
                durations_seconds=(4, 5, 8, 10),
                fps=(24,),
                aspect_ratios=("16:9", "9:16", "1:1"),
                notes="Images = références (départ non verrouillé) ; 480p par défaut. Accepte la "
                "vidéo grise du plateau comme référence de mouvement.",
            ),
            ModelCapabilities(
                provider=self.id,
                model="genjutsu_lite",
                label="Genjutsu Lite (vidéo de mouvement)",
                modes=("image_to_video",),
                controls=("reference_images", "camera_motion"),
                max_reference_images=10,
                max_width=1920,
                max_height=1920,
                durations_seconds=(4, 5, 8, 10),
                fps=(24,),
                aspect_ratios=("16:9", "9:16", "1:1"),
                notes="Exige la vidéo grise du plateau : reprend sa caméra, ses places et son "
                "rythme ; les images donnent personnages et décor. 720p par défaut, générations "
                "offertes utilisées en premier.",
            ),
            ModelCapabilities(
                provider=self.id,
                model="kling4_0",
                label="Kling 4.0 (vidéo de mouvement)",
                modes=("image_to_video",),
                controls=("reference_images", "camera_motion"),
                max_reference_images=10,
                max_width=1920,
                max_height=1920,
                durations_seconds=(4, 5, 8, 10),
                fps=(24,),
                aspect_ratios=("16:9", "9:16", "1:1"),
                notes="Exige la vidéo grise du plateau (mode reference-to-video). 720p par défaut.",
            ),
        ]

    def estimate_cost(self, model: str, request: GenerationRequest) -> CostEstimate:
        if model == "gpt_image_2_5":
            if request.options.get("resolution") == "1k":
                # Tarif 1K non relevé : le coût réel est enregistré après la génération.
                return CostEstimate(
                    3,
                    "crédits Higgsfield",
                    "GPT Image 2.5, 1K, qualité basse : au plus 3 crédits",
                    paid=True,
                )
            return CostEstimate(
                3, "crédits Higgsfield", "GPT Image 2.5, 2k, 1 image = 3 crédits", paid=True
            )
        resolution = video_resolution(model, request)
        seconds = request.duration_seconds or 4
        rate = RATES[model][resolution]
        basis = f"{LABELS[model]} {resolution} : {seconds} s x {rate:g} cr/s"
        if model == "genjutsu_lite":
            basis += " (gratuit tant qu'il reste des générations offertes)"
        return CostEstimate(seconds * rate, "crédits Higgsfield", basis, paid=True)

    def submit_generation(self, model: str, request: GenerationRequest, context: RunContext) -> str:
        available, reason = self.availability()
        if not available:
            raise ProviderError("provider_unavailable", reason)
        refs = [{"path": str(path), "name": path.name} for path in context.references]
        aspect = request.aspect_ratio or "16:9"
        mouvement = model in VIDEO_MODELS and context.motion_video is not None
        if model in {"genjutsu_lite", "kling4_0"} and not mouvement:
            raise ProviderError(
                "invalid_request", f"{LABELS[model]} exige la vidéo grise du plateau"
            )
        if mouvement:
            assert context.motion_video is not None  # noqa: S101
            resolution = video_resolution(model, request)
            width, height = MOTION_SIZES[resolution].get(aspect, MOTION_SIZES[resolution]["16:9"])
            job = {
                "model": model,
                "prompt": request.prompt,
                "video": {"path": str(context.motion_video)},
                "images": [{"path": ref["path"]} for ref in refs],
                "duration": request.duration_seconds or 5,
                "resolution": resolution,
                "aspect": aspect,
                "width": width,
                "height": height,
                "free": model == "genjutsu_lite" and request.options.get("free", True) is not False,
                "max_cost": self.estimate_cost(model, request).amount,
                "work": str(context.work),
            }
            script: str | Path = MOTION_SCRIPT
        elif model == "gpt_image_2_5":
            economique = request.options.get("resolution") == "1k"
            width, height = (SIZES_1K if economique else SIZES).get(aspect, SIZES["16:9"])
            job = {
                "prompt": request.prompt,
                "refs": refs,
                "model": "sunburst",
                "aspect_ratio": aspect,
                "quality": "low" if economique else "high",
                "resolution": "1k" if economique else "2k",
                "width": width,
                "height": height,
                "batch_size": 1,
            }
            script = IMAGE_SCRIPT
        else:
            resolution = video_resolution(model, request)
            draft = resolution == "480p"
            width, height = MOTION_SIZES[resolution].get(aspect, MOTION_SIZES[resolution]["16:9"])
            job = {
                "prompt": request.prompt,
                "refs": refs,
                "text_only": not refs,
                "duration": request.duration_seconds or 4,
                "resolution": resolution,
                "aspect": aspect,
                "width": width,
                "height": height,
                "draft": draft,
                "audio": False,
            }
            script = VIDEO_SCRIPT
        job_path = context.work / "higgsfield-job.json"
        job_path.write_text(json.dumps(job), encoding="utf-8")
        context.progress(0.2, "Génération lancée sur Higgsfield")
        try:
            result = subprocess.run(  # noqa: S603 (commande construite ici)
                [self._node, str(self._dir / script), str(job_path)],
                cwd=self._dir,
                capture_output=True,
                text=True,
                timeout=context.timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise ProviderError("timeout", "Higgsfield n'a pas répondu à temps") from exc
        lines = [line for line in result.stdout.splitlines() if line.startswith("{")]
        payload = json.loads(lines[-1]) if lines else {}
        if not payload.get("ok"):
            error = str(payload.get("error") or result.stderr[-300:] or "erreur inconnue")
            code: ErrorCode = (
                "content_policy"
                if "nsfw" in error.lower()
                else "authentication"
                if "no_auth" in error
                else "unknown"
            )
            raise ProviderError(code, f"Higgsfield : {error[:200]}")
        url = str(payload["url"])
        suffix = ".mp4" if model in VIDEO_MODELS else Path(url.split("?")[0]).suffix or ".png"
        target = context.work / f"higgsfield-{payload['id']}{suffix}"
        with urllib.request.urlopen(url, timeout=120) as response, target.open("wb") as handle:  # noqa: S310
            shutil.copyfileobj(response, handle)
        kind: Literal["image", "video"] = "video" if model in VIDEO_MODELS else "image"
        mime = (
            "video/mp4" if kind == "video" else ("image/png" if suffix == ".png" else "image/jpeg")
        )
        cost = payload.get("cost")
        self._results[str(payload["id"])] = [
            ProviderOutput(
                kind,
                target,
                mime,
                metadata={
                    "providerJobId": payload["id"],
                    # L'API interne compte en centièmes de crédit.
                    "actualCost": cost / 100 if isinstance(cost, int | float) else None,
                },
            )
        ]
        return str(payload["id"])

    def retrieve_outputs(self, external_id: str, context: RunContext) -> list[ProviderOutput]:
        return self._results.pop(external_id)
