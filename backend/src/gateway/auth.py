"""Authentication helpers for the API Gateway."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _get_secret() -> str:
    secret = os.getenv("INTERNAL_AUTH_JWT_SECRET") or os.getenv("BETTER_AUTH_SECRET")
    if not secret:
        raise RuntimeError("INTERNAL_AUTH_JWT_SECRET or BETTER_AUTH_SECRET must be configured")
    return secret


@dataclass(frozen=True)
class AuthContext:
    user_id: str
    email: str | None
    is_admin: bool
    session_id: str
    auth_provider: str | None = None


def _decode_token(token: str) -> AuthContext:
    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".")
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc

    signing_input = f"{encoded_header}.{encoded_payload}".encode("utf-8")
    expected_signature = hmac.new(_get_secret().encode("utf-8"), signing_input, hashlib.sha256).digest()
    actual_signature = _b64url_decode(encoded_signature)

    if not hmac.compare_digest(expected_signature, actual_signature):
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    try:
        payload = json.loads(_b64url_decode(encoded_payload).decode("utf-8"))
    except (ValueError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=401, detail="Invalid authentication token") from exc

    exp = payload.get("exp")
    sub = payload.get("sub")
    session_id = payload.get("session_id")
    if not isinstance(exp, int) or exp < int(time.time()):
        raise HTTPException(status_code=401, detail="Authentication token has expired")
    if not isinstance(sub, str) or not sub:
        raise HTTPException(status_code=401, detail="Authentication token missing subject")
    if not isinstance(session_id, str) or not session_id:
        raise HTTPException(status_code=401, detail="Authentication token missing session")

    email = payload.get("email")
    auth_provider = payload.get("auth_provider")
    return AuthContext(
        user_id=sub,
        email=email if isinstance(email, str) else None,
        is_admin=bool(payload.get("is_admin")),
        session_id=session_id,
        auth_provider=auth_provider if isinstance(auth_provider, str) else None,
    )


async def require_auth(authorization: str | None = Header(default=None)) -> AuthContext:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required")

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Authentication required")

    return _decode_token(token)


async def require_admin(auth: AuthContext = Depends(require_auth)) -> AuthContext:
    if not auth.is_admin:
        raise HTTPException(status_code=403, detail="Administrator access required")
    return auth
