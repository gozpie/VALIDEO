"""Commandes d'exploitation ponctuelles : ``python -m ass_api.cli <commande>``."""

import argparse
import sys

import boto3
from botocore.exceptions import ClientError

from ass_api.core.config import get_settings


def ensure_bucket() -> int:
    """Crée le bucket médias s'il n'existe pas (idempotent)."""
    settings = get_settings()
    client = boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url,
        region_name=settings.s3_region,
        aws_access_key_id=settings.s3_access_key_id.get_secret_value(),
        aws_secret_access_key=settings.s3_secret_access_key.get_secret_value(),
    )
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
        print(f"Bucket {settings.s3_bucket} déjà présent")  # noqa: T201
    except ClientError as exc:
        # Seule l'absence du bucket justifie sa création ; un refus d'accès doit échouer.
        if exc.response.get("Error", {}).get("Code") not in {"404", "NoSuchBucket"}:
            raise
        client.create_bucket(Bucket=settings.s3_bucket)
        print(f"Bucket {settings.s3_bucket} créé")  # noqa: T201
    return 0


COMMANDS = {"ensure-bucket": ensure_bucket}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ass_api.cli")
    parser.add_argument("command", choices=sorted(COMMANDS))
    args = parser.parse_args(argv)
    return COMMANDS[args.command]()


if __name__ == "__main__":
    sys.exit(main())
