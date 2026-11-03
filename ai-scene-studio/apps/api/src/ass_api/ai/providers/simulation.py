"""Fournisseur simulé, explicitement identifié : AUCUNE IA, aucun coût.

Sert aux tests automatiques de toute la chaîne (préparation, file, sorties, versions) sans appeler
de service payant. L'image produite est l'image de référence (ou une mire) filtrée par FFmpeg et
marquée « SIMULATION » ; la vidéo est un zoom lent sur cette image.
"""

import subprocess
import uuid

from ass_api.ai.capabilities import GenerationRequest, ModelCapabilities
from ass_api.ai.providers.base import (
    CostEstimate,
    ProviderAdapter,
    ProviderError,
    ProviderOutput,
    RunContext,
)

ASPECTS = ("16:9", "9:16", "1:1", "4:3", "21:9")


class SimulationProvider(ProviderAdapter):
    id = "simulation"
    label = "Simulation (aucune IA)"
    kind = "simulation"

    def __init__(self, ffmpeg: str) -> None:
        self._ffmpeg = ffmpeg
        self._results: dict[str, list[ProviderOutput]] = {}

    def get_capabilities(self) -> list[ModelCapabilities]:
        controls = ("first_frame", "reference_images", "depth", "normals")
        notes = "Aucune IA : filtre d'image déterministe pour tester la chaîne."
        return [
            ModelCapabilities(
                provider=self.id,
                model="image",
                label="Simulation image",
                modes=("text_to_image", "image_to_image"),
                controls=controls,
                max_reference_images=4,
                supports_seed=True,
                max_width=3840,
                max_height=2160,
                aspect_ratios=ASPECTS,
                notes=notes,
            ),
            ModelCapabilities(
                provider=self.id,
                model="video",
                label="Simulation vidéo",
                modes=("text_to_video", "image_to_video"),
                controls=controls,
                max_reference_images=4,
                supports_seed=True,
                max_width=3840,
                max_height=2160,
                durations_seconds=(2, 4, 5),
                fps=(24,),
                aspect_ratios=ASPECTS,
                notes=notes,
            ),
        ]

    def estimate_cost(self, model: str, request: GenerationRequest) -> CostEstimate:
        return CostEstimate(0, "gratuit", "Simulation locale, aucun appel externe", paid=False)

    def _ffmpeg_run(self, args: list[str]) -> None:
        result = subprocess.run(  # noqa: S603 (arguments construits ici)
            [self._ffmpeg, "-hide_banner", "-loglevel", "error", "-y", *args],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise ProviderError(
                "unknown", "Échec de la simulation (FFmpeg)", detail=result.stderr[-500:]
            )

    def submit_generation(self, model: str, request: GenerationRequest, context: RunContext) -> str:
        external_id = f"sim-{uuid.uuid4().hex[:12]}"
        width = request.width or 1280
        height = request.height or 720
        source = context.references[0] if context.references else None
        image = context.work / f"{external_id}.png"
        # Cadre rouge : marque visible de simulation, sans dépendre d'une police (drawtext).
        label = "drawbox=x=0:y=0:w=iw:h=ih:color=red@0.9:t=12"
        if source is not None:
            self._ffmpeg_run(
                [
                    "-i",
                    str(source),
                    "-vf",
                    f"scale={width}:{height},hue=s=0.4,eq=contrast=1.15:brightness=0.03,{label}",
                    "-frames:v",
                    "1",
                    str(image),
                ]
            )
        else:
            self._ffmpeg_run(
                [
                    "-f",
                    "lavfi",
                    "-i",
                    f"testsrc2=size={width}x{height}",
                    "-vf",
                    label,
                    "-frames:v",
                    "1",
                    str(image),
                ]
            )
        outputs = [ProviderOutput("image", image, "image/png", metadata={"simulated": True})]
        if model == "video":
            video = context.work / f"{external_id}.mp4"
            seconds = request.duration_seconds or 4
            frames = seconds * 24
            self._ffmpeg_run(
                [
                    "-loop",
                    "1",
                    "-i",
                    str(image),
                    "-vf",
                    f"zoompan=z='min(zoom+0.0015,1.2)':d={frames}:s={width}x{height}:fps=24,format=yuv420p",
                    "-t",
                    str(seconds),
                    "-c:v",
                    "libx264",
                    str(video),
                ]
            )
            outputs = [ProviderOutput("video", video, "video/mp4", metadata={"simulated": True})]
        self._results[external_id] = outputs
        return external_id

    def retrieve_outputs(self, external_id: str, context: RunContext) -> list[ProviderOutput]:
        return self._results.pop(external_id)
