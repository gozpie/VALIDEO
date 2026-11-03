"""Contrat commun des fournisseurs IA (équivalent Python de `ProviderAdapter`).

Les identifiants des fournisseurs ne quittent jamais le serveur ou le worker. `run` enchaîne
soumission, suivi, annulation et récupération des sorties avec un délai maximal ; un adaptateur
synchrone (outil en ligne de commande) peut tout faire dans `submit`.
"""

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal

from ass_api.ai.capabilities import (
    GenerationRequest,
    Mismatch,
    ModelCapabilities,
    match_capabilities,
)

ErrorCode = Literal[
    "invalid_request",
    "authentication",
    "quota_exceeded",
    "rate_limited",
    "content_policy",
    "timeout",
    "provider_unavailable",
    "cancelled",
    "unknown",
]


@dataclass(frozen=True)
class CostEstimate:
    amount: float
    unit: str
    basis: str
    # Un coût payant exige une confirmation explicite de l'utilisateur avant soumission.
    paid: bool


@dataclass
class ProviderOutput:
    kind: Literal["image", "video", "text", "json"]
    path: Path | None = None
    mime_type: str = ""
    data: Any = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass
class RunContext:
    work: Path
    references: list[Path]
    scene_summary: str
    progress: Callable[[float, str], bool]
    """Rapporte la progression ; renvoie True si l'annulation est demandée."""
    timeout_seconds: float = 1800
    # Documents texte du studio (script.md, bible.md, plan.md…) écrits dans le dossier de travail.
    documents: dict[str, str] = field(default_factory=dict)
    # Contexte court du projet (titre, format, cadence), repris dans la consigne.
    brief: str = ""


class ProviderError(Exception):
    def __init__(self, code: ErrorCode, message: str, *, retryable: bool = False, detail: str = ""):
        super().__init__(message)
        self.code = code
        self.retryable = retryable
        self.detail = detail


class ProviderAdapter:
    id: str = ""
    label: str = ""
    # official : API documentée ; subscription : abonnement via outil officiel ; bridge : passerelle
    # non officielle ; simulation : aucune IA (tests).
    kind: Literal["official", "subscription", "bridge", "simulation"] = "official"

    def get_capabilities(self) -> list[ModelCapabilities]:
        raise NotImplementedError

    def availability(self) -> tuple[bool, str]:
        return True, ""

    def capabilities_for(self, model: str) -> ModelCapabilities:
        for caps in self.get_capabilities():
            if caps.model == model:
                return caps
        raise ProviderError("invalid_request", f"Modèle inconnu pour {self.label} : {model}")

    def validate_request(self, model: str, request: GenerationRequest) -> list[Mismatch]:
        return match_capabilities(request, self.capabilities_for(model))

    def estimate_cost(self, model: str, request: GenerationRequest) -> CostEstimate:
        raise NotImplementedError

    def submit_generation(self, model: str, request: GenerationRequest, context: RunContext) -> str:
        raise NotImplementedError

    def get_job_status(self, external_id: str) -> tuple[str, float]:
        return "completed", 1.0

    def cancel_generation(self, external_id: str) -> None:
        return None

    def retrieve_outputs(self, external_id: str, context: RunContext) -> list[ProviderOutput]:
        raise NotImplementedError

    def normalize_error(self, error: Exception) -> ProviderError:
        if isinstance(error, ProviderError):
            return error
        if isinstance(error, TimeoutError):
            return ProviderError("timeout", "Délai dépassé chez le fournisseur", retryable=True)
        return ProviderError(
            "unknown", "Erreur inattendue du fournisseur", detail=type(error).__name__
        )

    def run(
        self, model: str, request: GenerationRequest, context: RunContext
    ) -> tuple[str, list[ProviderOutput]]:
        external_id = self.submit_generation(model, request, context)
        started = time.monotonic()
        while True:
            status, progress = self.get_job_status(external_id)
            if status == "completed":
                return external_id, self.retrieve_outputs(external_id, context)
            if status in ("failed", "cancelled"):
                raise ProviderError("unknown", f"Génération {status} chez le fournisseur")
            if context.progress(0.1 + 0.8 * progress, "Génération en cours chez le fournisseur"):
                self.cancel_generation(external_id)
                raise ProviderError("cancelled", "Génération annulée")
            if time.monotonic() - started > context.timeout_seconds:
                self.cancel_generation(external_id)
                raise ProviderError("timeout", "Délai maximal de génération dépassé")
            time.sleep(3)
