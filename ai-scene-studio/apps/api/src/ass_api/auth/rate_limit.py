"""Limitation des échecs de connexion, par adresse e-mail et par adresse IP.

Compteur à fenêtre fixe dans Redis (``INCR`` + ``EXPIRE``) : partagé entre les instances de l'API.
Si Redis est indisponible, la connexion est refusée (échec fermé) plutôt que non limitée.
"""

import hashlib
import time
from typing import Protocol

import redis

from ass_api.core.config import Settings


class RateLimiter(Protocol):
    def failures(self, key: str) -> int: ...

    def record_failure(self, key: str) -> None: ...

    def reset(self, key: str) -> None: ...


def email_key(email: str) -> str:
    # L'adresse n'apparaît pas en clair dans Redis.
    return "login:email:" + hashlib.sha256(email.encode("utf-8")).hexdigest()


def ip_key(ip: str) -> str:
    return f"login:ip:{ip}"


class RedisRateLimiter:
    def __init__(self, client: "redis.Redis", window_seconds: int) -> None:
        self._client = client
        self._window = window_seconds

    @classmethod
    def from_settings(cls, settings: Settings) -> "RedisRateLimiter":
        client = redis.Redis.from_url(
            settings.redis_url.get_secret_value(),
            socket_connect_timeout=settings.health_check_timeout_seconds,
            socket_timeout=settings.health_check_timeout_seconds,
        )
        return cls(client, settings.login_failure_window_seconds)

    def failures(self, key: str) -> int:
        value = self._client.get(key)
        return int(value) if isinstance(value, bytes | str | int) else 0

    def record_failure(self, key: str) -> None:
        pipeline = self._client.pipeline()
        pipeline.incr(key)
        # NX : la fenêtre démarre au premier échec et n'est pas prolongée par les suivants.
        pipeline.expire(key, self._window, nx=True)
        pipeline.execute()

    def reset(self, key: str) -> None:
        self._client.delete(key)

    def close(self) -> None:
        self._client.close()


class InMemoryRateLimiter:
    """Implémentation locale pour les tests (non partagée entre processus)."""

    def __init__(self, window_seconds: int) -> None:
        self._window = window_seconds
        self._counters: dict[str, tuple[int, float]] = {}

    def failures(self, key: str) -> int:
        count, expires_at = self._counters.get(key, (0, 0.0))
        return count if expires_at > time.monotonic() else 0

    def record_failure(self, key: str) -> None:
        count = self.failures(key)
        expires_at = self._counters[key][1] if count else time.monotonic() + self._window
        self._counters[key] = (count + 1, expires_at)

    def reset(self, key: str) -> None:
        self._counters.pop(key, None)
