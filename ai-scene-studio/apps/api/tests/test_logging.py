from ass_api.core.logging import redact_sensitive


def test_sensitive_keys_are_redacted_recursively() -> None:
    event = {
        "event": "call",
        "api_key": "abc",
        "headers": {"Authorization": "Bearer x", "Accept": "json"},
        "items": [{"password": "p"}],
    }
    result = redact_sensitive(None, "info", event)
    assert result["api_key"] == "***"
    assert result["headers"] == {"Authorization": "***", "Accept": "json"}
    assert result["items"] == [{"password": "***"}]
    assert result["event"] == "call"
