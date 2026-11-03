"""Commandes d'exploitation ponctuelles : ``python -m ass_api.cli <commande>``."""

import argparse
import getpass
import re
import sys

import boto3
from botocore.exceptions import ClientError
from sqlalchemy import select

from ass_api.auth.passwords import WeakPasswordError, hash_password
from ass_api.auth.sessions import normalize_email
from ass_api.core.config import get_settings
from ass_api.db.models import User
from ass_api.db.session import create_session_factory

_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def ensure_bucket(_args: argparse.Namespace) -> int:
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


def _read_password(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.readline().rstrip("\n")
    password = getpass.getpass("Mot de passe : ")
    if getpass.getpass("Confirmation : ") != password:
        raise ValueError("Les deux saisies diffèrent")
    return password


def create_user(args: argparse.Namespace) -> int:
    """Crée un compte avec mot de passe local (amorçage : l'inscription publique est fermée)."""
    email = normalize_email(args.email)
    display_name = args.display_name.strip()
    if not _EMAIL.match(email) or len(email) > 320:
        print("Adresse e-mail invalide", file=sys.stderr)  # noqa: T201
        return 2
    if not 0 < len(display_name) <= 120:
        print("Nom affiché vide ou trop long (120 caractères max)", file=sys.stderr)  # noqa: T201
        return 2
    try:
        password_hash = hash_password(_read_password(args.password_stdin))
    except (WeakPasswordError, ValueError) as exc:
        print(exc, file=sys.stderr)  # noqa: T201
        return 2
    engine, factory = create_session_factory(get_settings())
    try:
        with factory() as db:
            if db.scalars(select(User).where(User.email == email)).first() is not None:
                print(f"Un compte existe déjà pour {email}", file=sys.stderr)  # noqa: T201
                return 1
            user = User(email=email, display_name=display_name, password_hash=password_hash)
            db.add(user)
            db.commit()
            print(f"Compte créé : {email} ({user.id})")  # noqa: T201
    finally:
        engine.dispose()
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ass_api.cli")
    commands = parser.add_subparsers(dest="command", required=True)

    commands.add_parser("ensure-bucket", help="crée le bucket S3 s'il n'existe pas").set_defaults(
        handler=ensure_bucket
    )

    user_parser = commands.add_parser("create-user", help="crée un compte avec mot de passe")
    user_parser.add_argument("--email", required=True)
    user_parser.add_argument("--display-name", required=True)
    user_parser.add_argument(
        "--password-stdin", action="store_true", help="lit le mot de passe sur l'entrée standard"
    )
    user_parser.set_defaults(handler=create_user)

    args = parser.parse_args(argv)
    result: int = args.handler(args)
    return result


if __name__ == "__main__":
    sys.exit(main())
