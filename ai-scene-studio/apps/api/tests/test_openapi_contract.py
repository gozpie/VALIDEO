"""Le contrat OpenAPI versionné (source des types TypeScript) correspond à l'API."""

from pathlib import Path

from ass_api.cli import openapi_document

ROOT = Path(__file__).resolve().parents[3]
CONTRACT = ROOT / "packages/api-client/openapi.json"


def test_committed_contract_is_up_to_date() -> None:
    assert CONTRACT.read_text(encoding="utf-8") == openapi_document(), (
        "Contrat OpenAPI périmé : lancer « pnpm api:generate » et commiter le résultat"
    )
