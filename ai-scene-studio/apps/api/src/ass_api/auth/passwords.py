"""Hachage des mots de passe (Argon2id, paramètres RFC 9106 d'argon2-cffi) et politique minimale."""

from typing import Final

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

MIN_LENGTH: Final = 12
# Borne haute : le coût d'Argon2 dépend peu de la longueur, mais un corps démesuré reste refusé.
MAX_LENGTH: Final = 1024

_hasher = PasswordHasher()
# Empreinte factice : vérifiée quand le compte n'existe pas, pour un temps de réponse comparable.
_DUMMY_HASH: Final = _hasher.hash("compte-inexistant-temps-constant")


class WeakPasswordError(ValueError):
    pass


def check_policy(password: str) -> None:
    if len(password) < MIN_LENGTH:
        raise WeakPasswordError(f"Le mot de passe doit contenir au moins {MIN_LENGTH} caractères")
    if len(password) > MAX_LENGTH:
        raise WeakPasswordError(f"Le mot de passe ne doit pas dépasser {MAX_LENGTH} caractères")


def hash_password(password: str) -> str:
    check_policy(password)
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    """Vrai si le mot de passe correspond. Sans empreinte, consomme le même temps et refuse."""
    if len(password) > MAX_LENGTH:
        return False
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _hasher.check_needs_rehash(password_hash)
