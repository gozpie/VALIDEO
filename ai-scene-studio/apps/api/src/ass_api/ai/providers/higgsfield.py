"""Higgsfield par passerelle navigateur (NON OFFICIELLE) sur l'abonnement du compte connecté.

L'API publique de Higgsfield est un produit distinct (clé et solde prépayé en dollars) : elle ne
consomme pas les crédits d'un abonnement. Cette passerelle réutilise les scripts de VALIDEO qui
appellent l'API interne du site depuis l'onglet Higgsfield ouvert dans Chrome (port de débogage
9222, compte connecté) : elle ne tourne que sur le Mac où Chrome est ouvert, et l'API interne peut
changer sans préavis. Chaque génération consomme des crédits : l'API exige de confirmer le coût.

Coûts relevés (crédits affichés ; l'API interne renvoie des centièmes) : GPT Image 2.5 en 2k = 3 cr
par image ; Seedance 2.5 = 3 cr/s en brouillon 480p, 12 cr/s en 1080p.
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
VIDEO_SIZES: Final = {
    True: {"16:9": (854, 480), "9:16": (480, 854), "1:1": (480, 480)},
    False: {"16:9": (1920, 1080), "9:16": (1080, 1920), "1:1": (1080, 1080)},
}
IMAGE_SCRIPT: Final = "generate_higgsfield_image_api.mjs"
VIDEO_SCRIPT: Final = "generate_higgsfield_seedance_api.mjs"


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
                controls=("reference_images",),
                max_reference_images=4,
                max_width=1920,
                max_height=1920,
                durations_seconds=(4, 5, 8, 10),
                fps=(24,),
                aspect_ratios=("16:9", "9:16", "1:1"),
                notes="Images = références (départ non verrouillé) ; brouillon 480p par défaut.",
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
        draft = bool(request.options.get("draft", True))
        seconds = request.duration_seconds or 4
        rate = 3 if draft else 12
        return CostEstimate(
            seconds * rate,
            "crédits Higgsfield",
            f"Seedance 2.5 {'brouillon 480p' if draft else '1080p'} : {seconds} s x {rate} cr/s",
            paid=True,
        )

    def submit_generation(self, model: str, request: GenerationRequest, context: RunContext) -> str:
        available, reason = self.availability()
        if not available:
            raise ProviderError("provider_unavailable", reason)
        refs = [{"path": str(path), "name": path.name} for path in context.references]
        aspect = request.aspect_ratio or "16:9"
        if model == "gpt_image_2_5":
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
            draft = bool(request.options.get("draft", True))
            width, height = VIDEO_SIZES[draft].get(aspect, VIDEO_SIZES[draft]["16:9"])
            job = {
                "prompt": request.prompt,
                "refs": refs,
                "text_only": not refs,
                "duration": request.duration_seconds or 4,
                "resolution": "480p" if draft else "1080p",
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
        suffix = ".mp4" if model == "seedance_2_5" else Path(url.split("?")[0]).suffix or ".png"
        target = context.work / f"higgsfield-{payload['id']}{suffix}"
        with urllib.request.urlopen(url, timeout=120) as response, target.open("wb") as handle:  # noqa: S310
            shutil.copyfileobj(response, handle)
        kind: Literal["image", "video"] = "video" if model == "seedance_2_5" else "image"
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
