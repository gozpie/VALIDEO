"""Jetons opaques : le cookie porte le jeton, la base n'en garde que l'empreinte."""

import hashlib
import secrets


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def same_token(expected: str, received: str) -> bool:
    return secrets.compare_digest(expected.encode("utf-8"), received.encode("utf-8"))
