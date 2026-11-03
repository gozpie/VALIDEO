"""Briques d'authentification sans base : mots de passe, jetons, limiteur, configuration."""

import hashlib
import time

import pytest
from pydantic import ValidationError

from ass_api.auth import passwords
from ass_api.auth.rate_limit import InMemoryRateLimiter, email_key, ip_key
from ass_api.auth.sessions import normalize_email
from ass_api.auth.tokens import new_token, same_token, token_hash
from ass_api.core.config import Settings

GOOD_PASSWORD = "correct horse battery staple"


def test_hash_is_argon2id_and_verifies() -> None:
    hashed = passwords.hash_password(GOOD_PASSWORD)
    assert hashed.startswith("$argon2id$")
    assert passwords.verify_password(hashed, GOOD_PASSWORD)
    assert not passwords.verify_password(hashed, GOOD_PASSWORD + "!")
    assert not passwords.needs_rehash(hashed)


def test_hashes_are_salted() -> None:
    assert passwords.hash_password(GOOD_PASSWORD) != passwords.hash_password(GOOD_PASSWORD)


@pytest.mark.parametrize("password", ["court", "x" * (passwords.MAX_LENGTH + 1)])
def test_policy_rejects(password: str) -> None:
    with pytest.raises(passwords.WeakPasswordError):
        passwords.hash_password(password)


def test_missing_hash_never_verifies() -> None:
    assert not passwords.verify_password(None, GOOD_PASSWORD)
    assert not passwords.verify_password(None, "compte-inexistant-temps-constant")


def test_corrupted_hash_is_rejected_without_error() -> None:
    assert not passwords.verify_password("pas-une-empreinte", GOOD_PASSWORD)


def test_tokens() -> None:
    token = new_token()
    assert len(token) >= 43
    assert token != new_token()
    assert token_hash(token) == hashlib.sha256(token.encode()).hexdigest()
    assert same_token(token, token)
    assert not same_token(token, token[:-1])


def test_email_normalization() -> None:
    assert normalize_email("  Pierre@Example.TEST ") == "pierre@example.test"


def test_rate_limit_keys_do_not_leak_email() -> None:
    assert "pierre" not in email_key("pierre@example.test")
    assert ip_key("10.0.0.1") == "login:ip:10.0.0.1"


def test_in_memory_limiter_counts_and_expires() -> None:
    limiter = InMemoryRateLimiter(window_seconds=1)
    limiter.record_failure("k")
    limiter.record_failure("k")
    assert limiter.failures("k") == 2
    limiter.reset("k")
    assert limiter.failures("k") == 0
    short = InMemoryRateLimiter(window_seconds=0)
    short.record_failure("k")
    time.sleep(0.01)
    assert short.failures("k") == 0


def test_production_requires_secure_cookie() -> None:
    with pytest.raises(ValidationError, match="ASS_SESSION_COOKIE_SECURE"):
        Settings(
            environment="production",
            database_url="postgresql+psycopg://app:s3cret@db:5432/ass",
            s3_access_key_id="prod-key",
            s3_secret_access_key="prod-secret",
            session_cookie_secure=False,
        )


def test_cookie_name_is_validated() -> None:
    with pytest.raises(ValidationError):
        Settings(session_cookie_name="bad name;")
