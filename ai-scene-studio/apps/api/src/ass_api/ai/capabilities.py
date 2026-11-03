"""Capacités déclarées des modèles et requêtes de génération (portage de `@ass/generation-sdk`).

Chaque capacité est explicite : une contrainte non supportée n'est jamais envoyée en supposant
qu'elle sera respectée ; elle est signalée « bloquante » ou « ignorée » à l'utilisateur.
"""

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

Mode = Literal[
    "text_to_image",
    "image_to_image",
    "text_to_video",
    "image_to_video",
    # Modes texte (assistants) : la sortie est du texte structuré, pas un média.
    "prompt_from_scene",
    "scene_from_text",
    "image_analysis",
    # Studio de production (phase 6) : découpage, bible, prompts d'un plan.
    "script_breakdown",
    "bible_from_script",
    "shot_prompts",
    # Montage : plans du film envoyés à gozCut.
    "gozcut_project",
]
Control = Literal[
    "first_frame",
    "last_frame",
    "reference_images",
    "mask",
    "depth",
    "normals",
    "segmentation",
    "camera_motion",
    "motion",
]
VIDEO_MODES = frozenset({"text_to_video", "image_to_video"})
MEDIA_MODES = frozenset({"text_to_image", "image_to_image", "text_to_video", "image_to_video"})
# Modes qui lisent la scène 3D (révision obligatoire) et modes du studio rattachés au projet.
SCENE_MODES = frozenset({"prompt_from_scene", "scene_from_text", "image_analysis"})
PROJECT_MODES = frozenset({"script_breakdown", "bible_from_script", "gozcut_project"})
SCRIPT_MODES = frozenset({"script_breakdown", "bible_from_script"})


@dataclass(frozen=True)
class ModelCapabilities:
    provider: str
    model: str
    label: str
    modes: tuple[str, ...]
    controls: tuple[str, ...] = ()
    max_reference_images: int = 0
    supports_seed: bool = False
    max_width: int = 0
    max_height: int = 0
    durations_seconds: tuple[int, ...] = ()
    fps: tuple[int, ...] = ()
    aspect_ratios: tuple[str, ...] = ()
    notes: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class GenerationRequest:
    mode: str
    prompt: str
    negative_prompt: str = ""
    controls: list[str] = field(default_factory=list)
    reference_count: int = 0
    seed: int | None = None
    width: int = 0
    height: int = 0
    duration_seconds: int | None = None
    fps: int | None = None
    aspect_ratio: str | None = None
    options: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Mismatch:
    field: str
    severity: Literal["blocking", "ignored"]
    message: str


def match_capabilities(request: GenerationRequest, caps: ModelCapabilities) -> list[Mismatch]:
    found: list[Mismatch] = []
    if request.mode not in caps.modes:
        found.append(
            Mismatch("mode", "blocking", f"{caps.label} ne supporte pas le mode {request.mode}")
        )
    for control in request.controls:
        if control not in caps.controls:
            found.append(
                Mismatch(
                    f"controls.{control}",
                    "ignored",
                    f"La contrainte « {control} » n'est pas prise en compte par {caps.label} : "
                    "le contrôle est seulement indicatif",
                )
            )
    if request.reference_count > caps.max_reference_images:
        found.append(
            Mismatch(
                "referenceCount",
                "blocking",
                f"Au plus {caps.max_reference_images} image(s) de référence pour {caps.label}",
            )
        )
    if request.seed is not None and not caps.supports_seed:
        found.append(
            Mismatch("seed", "ignored", "Seed non supporté : le résultat ne sera pas reproductible")
        )
    if (
        request.mode in MEDIA_MODES
        and caps.max_width
        and (request.width > caps.max_width or request.height > caps.max_height)
    ):
        found.append(
            Mismatch(
                "resolution",
                "blocking",
                f"Résolution {request.width} x {request.height} au-delà de "
                f"{caps.max_width} x {caps.max_height}",
            )
        )
    if request.mode in VIDEO_MODES:
        if request.duration_seconds not in caps.durations_seconds:
            accepted = ", ".join(map(str, caps.durations_seconds)) or "aucune"
            found.append(
                Mismatch("durationSeconds", "blocking", f"Durée non supportée ({accepted} s)")
            )
        if request.fps is not None and caps.fps and request.fps not in caps.fps:
            found.append(Mismatch("fps", "ignored", f"{caps.label} produit en {caps.fps[0]} i/s"))
    if (
        request.aspect_ratio
        and caps.aspect_ratios
        and request.aspect_ratio not in caps.aspect_ratios
    ):
        found.append(
            Mismatch("aspectRatio", "blocking", f"Format {request.aspect_ratio} non supporté")
        )
    return found
