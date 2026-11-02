"""Tests d'intégration contre de vraies dépendances (docker compose up postgres redis minio).

Ignorés par défaut ; activer avec ASS_RUN_INTEGRATION=1. ASS_INTEGRATION_CHECKS restreint
la liste des dépendances testées (ex. « database,redis » quand MinIO n'est pas disponible).
"""

import os

import pytest

from ass_api.core.config import Settings
from ass_api.core.health import DEFAULT_CHECKS, run_checks

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.environ.get("ASS_RUN_INTEGRATION") != "1", reason="ASS_RUN_INTEGRATION != 1"
    ),
]

SELECTED = [
    name.strip()
    for name in os.environ.get("ASS_INTEGRATION_CHECKS", ",".join(DEFAULT_CHECKS)).split(",")
    if name.strip()
]


@pytest.mark.parametrize("name", SELECTED)
async def test_dependency_is_reachable(name: str) -> None:
    results = await run_checks(Settings(), {name: DEFAULT_CHECKS[name]})
    assert results[name].status == "ok", results[name].detail
