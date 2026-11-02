"""Logs structurés (JSON) avec masquage systématique des valeurs sensibles."""

import logging
import re
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog

_SENSITIVE_KEY = re.compile(r"pass(word)?|secret|token|authorization|api[_-]?key|cookie", re.I)
_REDACTED = "***"


def redact_sensitive(
    _logger: Any, _method: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    """Processeur structlog : remplace les valeurs dont la clé évoque un secret."""

    def _redact(value: Any) -> Any:
        if isinstance(value, dict):
            return {
                key: _REDACTED if _SENSITIVE_KEY.search(str(key)) else _redact(item)
                for key, item in value.items()
            }
        if isinstance(value, list):
            return [_redact(item) for item in value]
        return value

    for key in list(event_dict.keys()):
        if _SENSITIVE_KEY.search(key):
            event_dict[key] = _REDACTED
        else:
            event_dict[key] = _redact(event_dict[key])
    return event_dict


def configure_logging(level: str = "INFO", *, json_output: bool = True) -> None:
    """Configure structlog et redirige la journalisation standard vers stdout."""
    renderer: Any = (
        structlog.processors.JSONRenderer() if json_output else structlog.dev.ConsoleRenderer()
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            redact_sensitive,
            structlog.processors.format_exc_info,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level)),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stdout),
        cache_logger_on_first_use=True,
    )
    logging.basicConfig(level=level, format="%(message)s", stream=sys.stdout, force=True)
