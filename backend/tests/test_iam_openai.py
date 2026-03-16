from __future__ import annotations

import httpx

from src.models.iam_openai import IAMAuth, IAMTokenManager


class DummyTokenManager:
    def __init__(self, token: str):
        self._token = token

    def get_token(self) -> str:
        return self._token

    async def aget_token(self) -> str:
        return self._token


def test_parse_expires_on_seconds_and_ms():
    epoch_seconds = 1_700_000_000
    parsed_seconds = IAMTokenManager._parse_expires_on(epoch_seconds)
    parsed_millis = IAMTokenManager._parse_expires_on(epoch_seconds * 1000)
    assert parsed_seconds == parsed_millis


def test_iam_auth_injects_header_and_query_param():
    auth = IAMAuth(
        DummyTokenManager("token-123"),
        auth_header_prefix="",
        api_key_query_param="api_key",
        api_key_value="k-abc",
    )

    request = httpx.Request("GET", "https://example.com/v1/chat/completions")
    prepared = next(auth.auth_flow(request))

    assert prepared.headers.get("Authorization") == "token-123"
    assert prepared.url.params.get("api_key") == "k-abc"


def test_iam_auth_prefix_adds_space():
    auth = IAMAuth(
        DummyTokenManager("token-123"),
        auth_header_prefix="Bearer",
    )

    request = httpx.Request("GET", "https://example.com/v1/chat/completions")
    prepared = next(auth.auth_flow(request))

    assert prepared.headers.get("Authorization") == "Bearer token-123"
