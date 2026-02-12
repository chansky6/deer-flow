# Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
# SPDX-License-Identifier: MIT

import logging
import os
import secrets
from datetime import datetime, timezone, timedelta

import httpx
import jwt
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import RedirectResponse

logger = logging.getLogger(__name__)

auth_router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_COOKIE_NAME = "deerflow_session"
STATE_COOKIE_NAME = "deerflow_oauth_state"


def is_auth_enabled() -> bool:
    return os.getenv("ENABLE_AUTH", "false").lower() in ("true", "1", "yes")


def _get_jwt_secret() -> str:
    return os.getenv("AUTH_JWT_SECRET", "change-me-to-a-random-secret")


def _get_jwt_expiry_hours() -> int:
    try:
        return int(os.getenv("AUTH_JWT_EXPIRY_HOURS", "24"))
    except ValueError:
        return 24


def create_session_token(user_data: dict) -> str:
    payload = {
        **user_data,
        "exp": datetime.now(timezone.utc) + timedelta(hours=_get_jwt_expiry_hours()),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, _get_jwt_secret(), algorithm="HS256")


def verify_session_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, _get_jwt_secret(), algorithms=["HS256"])
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None


def require_auth(request: Request) -> dict | None:
    """FastAPI dependency. Returns None when auth disabled, user dict when valid, raises 401 otherwise."""
    if not is_auth_enabled():
        return None
    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = verify_session_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")
    return user


@auth_router.get("/login")
async def login(response: Response):
    if not is_auth_enabled():
        raise HTTPException(status_code=404, detail="Auth is not enabled")

    state = secrets.token_urlsafe(32)
    authorize_url = os.getenv(
        "OAUTH_AUTHORIZE_URL", "https://connect.linux.do/oauth2/authorize"
    )
    client_id = os.getenv("OAUTH_CLIENT_ID", "")
    redirect_uri = os.getenv("OAUTH_REDIRECT_URI", "http://localhost:7800/api/auth/callback")

    url = (
        f"{authorize_url}"
        f"?response_type=code"
        f"&client_id={client_id}"
        f"&redirect_uri={redirect_uri}"
        f"&scope=openid profile"
        f"&state={state}"
    )

    redirect = RedirectResponse(url=url, status_code=302)
    redirect.set_cookie(
        STATE_COOKIE_NAME,
        state,
        httponly=True,
        max_age=600,
        samesite="lax",
    )
    return redirect


@auth_router.get("/callback")
async def callback(
    code: str,
    state: str,
    request: Request,
):
    if not is_auth_enabled():
        raise HTTPException(status_code=404, detail="Auth is not enabled")

    stored_state = request.cookies.get(STATE_COOKIE_NAME)
    if not stored_state or stored_state != state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    token_url = os.getenv(
        "OAUTH_TOKEN_URL", "https://connect.linux.do/oauth2/token"
    )
    client_id = os.getenv("OAUTH_CLIENT_ID", "")
    client_secret = os.getenv("OAUTH_CLIENT_SECRET", "")
    redirect_uri = os.getenv("OAUTH_REDIRECT_URI", "http://localhost:7800/api/auth/callback")

    async with httpx.AsyncClient() as client:
        # Exchange code for token
        token_resp = await client.post(
            token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
                "client_id": client_id,
                "client_secret": client_secret,
            },
            headers={"Accept": "application/json"},
        )
        if token_resp.status_code != 200:
            logger.error(f"Token exchange failed: {token_resp.status_code} {token_resp.text}")
            raise HTTPException(status_code=400, detail="Failed to exchange authorization code")

        token_data = token_resp.json()
        access_token = token_data.get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="No access token received")

        # Fetch user info
        user_url = os.getenv(
            "OAUTH_USER_URL", "https://connect.linux.do/api/user"
        )
        user_resp = await client.get(
            user_url,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Accept": "application/json",
            },
        )
        if user_resp.status_code != 200:
            logger.error(f"User info fetch failed: {user_resp.status_code} {user_resp.text}")
            raise HTTPException(status_code=400, detail="Failed to fetch user info")

        user_info = user_resp.json()

    user_data = {
        "id": str(user_info.get("id", "")),
        "username": user_info.get("username", user_info.get("name", "")),
        "avatar_url": user_info.get("avatar_url", user_info.get("avatar_template", "")),
    }

    session_token = create_session_token(user_data)
    frontend_url = os.getenv("OAUTH_FRONTEND_URL", "http://localhost:3000")

    redirect = RedirectResponse(url=f"{frontend_url}/chat", status_code=302)
    redirect.set_cookie(
        SESSION_COOKIE_NAME,
        session_token,
        httponly=True,
        max_age=_get_jwt_expiry_hours() * 3600,
        samesite="lax",
    )
    redirect.delete_cookie(STATE_COOKIE_NAME)
    return redirect


@auth_router.get("/me")
async def me(request: Request):
    if not is_auth_enabled():
        raise HTTPException(status_code=404, detail="Auth is not enabled")

    token = request.cookies.get(SESSION_COOKIE_NAME)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    user = verify_session_token(token)
    if not user:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    return {
        "id": user.get("id", ""),
        "username": user.get("username", ""),
        "avatar_url": user.get("avatar_url", ""),
    }


@auth_router.post("/logout")
async def logout():
    response = Response(status_code=200)
    response.delete_cookie(SESSION_COOKIE_NAME)
    return response
