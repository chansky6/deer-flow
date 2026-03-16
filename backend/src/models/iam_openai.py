"""OpenAI-compatible ChatOpenAI with IAM token authentication."""

from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from langchain_openai import ChatOpenAI
from pydantic import Field, PrivateAttr


@dataclass
class _IAMToken:
    access_token: str
    expires_at: datetime


class IAMTokenManager:
    def __init__(
        self,
        *,
        token_url: str,
        account: str,
        secret: str,
        project: str,
        enterprise: str,
        refresh_skew_seconds: int = 60,
        request_timeout: float = 15.0,
    ) -> None:
        self._token_url = token_url
        self._account = account
        self._secret = secret
        self._project = project
        self._enterprise = enterprise
        self._refresh_skew_seconds = max(int(refresh_skew_seconds), 0)
        self._request_timeout = request_timeout
        self._token: _IAMToken | None = None
        self._lock = threading.Lock()
        self._async_lock = asyncio.Lock()

    def get_token(self) -> str:
        token = self._token
        if token and not self._is_expiring(token):
            return token.access_token

        with self._lock:
            token = self._token
            if token and not self._is_expiring(token):
                return token.access_token
            fresh = self._fetch_token_sync()
            self._token = fresh
            return fresh.access_token

    async def aget_token(self) -> str:
        token = self._token
        if token and not self._is_expiring(token):
            return token.access_token

        async with self._async_lock:
            token = self._token
            if token and not self._is_expiring(token):
                return token.access_token
            fresh = await self._fetch_token_async()
            self._token = fresh
            return fresh.access_token

    def _is_expiring(self, token: _IAMToken) -> bool:
        now = datetime.now(UTC)
        return token.expires_at <= now + timedelta(seconds=self._refresh_skew_seconds)

    def _build_payload(self) -> dict[str, Any]:
        return {
            "data": {
                "type": "token",
                "attributes": {
                    "account": self._account,
                    "secret": self._secret,
                    "project": self._project,
                    "enterprise": self._enterprise,
                },
            }
        }

    @staticmethod
    def _parse_expires_on(expires_on: Any) -> datetime:
        if expires_on is None:
            raise ValueError("IAM token response missing 'expires_on'")

        try:
            raw_value = float(expires_on)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"Invalid expires_on value: {expires_on}") from exc

        # Detect millisecond timestamps (e.g. 1.7e12) vs seconds (1.7e9).
        if raw_value > 1e11:
            raw_value = raw_value / 1000.0

        return datetime.fromtimestamp(raw_value, tz=UTC)

    def _fetch_token_sync(self) -> _IAMToken:
        headers = {"Content-Type": "application/json"}
        payload = self._build_payload()
        timeout = self._request_timeout

        with httpx.Client(timeout=timeout) as client:
            response = client.post(self._token_url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        access_token = data.get("access_token")
        if not access_token:
            raise ValueError("IAM token response missing 'access_token'")

        expires_at = self._parse_expires_on(data.get("expires_on"))
        return _IAMToken(access_token=str(access_token), expires_at=expires_at)

    async def _fetch_token_async(self) -> _IAMToken:
        headers = {"Content-Type": "application/json"}
        payload = self._build_payload()
        timeout = self._request_timeout

        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(self._token_url, json=payload, headers=headers)
            response.raise_for_status()
            data = response.json()

        access_token = data.get("access_token")
        if not access_token:
            raise ValueError("IAM token response missing 'access_token'")

        expires_at = self._parse_expires_on(data.get("expires_on"))
        return _IAMToken(access_token=str(access_token), expires_at=expires_at)


class IAMAuth(httpx.Auth):
    def __init__(
        self,
        token_manager: IAMTokenManager,
        *,
        auth_header_prefix: str = "",
        api_key_query_param: str = "api_key",
        api_key_value: str | None = None,
    ) -> None:
        self._token_manager = token_manager
        self._auth_header_prefix = auth_header_prefix or ""
        self._api_key_query_param = api_key_query_param
        self._api_key_value = api_key_value

    def _format_auth_header(self, token: str) -> str:
        if not self._auth_header_prefix:
            return token
        if self._auth_header_prefix.endswith(" "):
            return f"{self._auth_header_prefix}{token}"
        return f"{self._auth_header_prefix} {token}"

    def _apply_query_param(self, request: httpx.Request) -> None:
        if not self._api_key_value:
            return
        params = dict(request.url.params)
        params[self._api_key_query_param] = self._api_key_value
        request.url = request.url.copy_with(params=params)

    def auth_flow(self, request: httpx.Request) -> Any:
        token = self._token_manager.get_token()
        request.headers["Authorization"] = self._format_auth_header(token)
        self._apply_query_param(request)
        yield request

    async def async_auth_flow(self, request: httpx.Request) -> Any:
        token = await self._token_manager.aget_token()
        request.headers["Authorization"] = self._format_auth_header(token)
        self._apply_query_param(request)
        yield request


class IAMChatOpenAI(ChatOpenAI):
    """ChatOpenAI with IAM token injection into Authorization header."""

    iam_token_url: str = Field(..., description="IAM token endpoint URL")
    iam_account: str = Field(..., description="IAM account")
    iam_secret: str = Field(..., description="IAM secret")
    iam_project: str = Field(..., description="IAM project")
    iam_enterprise: str = Field(..., description="IAM enterprise")
    iam_refresh_skew_seconds: int = Field(default=60, description="Seconds to refresh token before expiry")
    iam_request_timeout: float = Field(default=15.0, description="Timeout (seconds) for IAM token requests")
    iam_auth_header_prefix: str = Field(default="", description="Authorization header prefix (default: raw token)")

    _iam_token_manager: IAMTokenManager = PrivateAttr()
    _iam_auth: IAMAuth = PrivateAttr()

    def __init__(self, **data: Any) -> None:
        token_url = data.get("iam_token_url")
        account = data.get("iam_account")
        secret = data.get("iam_secret")
        project = data.get("iam_project")
        enterprise = data.get("iam_enterprise")

        if not token_url:
            raise ValueError("iam_token_url is required for IAMChatOpenAI")
        if not account or not secret or not project or not enterprise:
            raise ValueError("iam_account, iam_secret, iam_project, iam_enterprise are required for IAMChatOpenAI")

        refresh_skew_seconds = data.get("iam_refresh_skew_seconds", 60)
        request_timeout = data.get("iam_request_timeout", 15.0)
        auth_header_prefix = data.get("iam_auth_header_prefix", "")

        token_manager = IAMTokenManager(
            token_url=token_url,
            account=account,
            secret=secret,
            project=project,
            enterprise=enterprise,
            refresh_skew_seconds=refresh_skew_seconds,
            request_timeout=request_timeout,
        )

        api_key_value = data.get("api_key")
        auth = IAMAuth(
            token_manager,
            auth_header_prefix=auth_header_prefix,
            api_key_query_param="api_key",
            api_key_value=api_key_value,
        )

        # Ensure OpenAI client has an API key, but override Authorization via IAM auth.
        if not data.get("api_key"):
            data["api_key"] = "iam-placeholder"

        request_timeout = data.get("request_timeout")
        data["http_client"] = httpx.Client(auth=auth, timeout=request_timeout)
        data["http_async_client"] = httpx.AsyncClient(auth=auth, timeout=request_timeout)

        super().__init__(**data)

        self._iam_token_manager = token_manager
        self._iam_auth = auth
