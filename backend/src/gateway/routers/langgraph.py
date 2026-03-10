"""Authenticated proxy for LangGraph thread and run APIs."""

from __future__ import annotations

import json
import logging
import os
from collections.abc import Mapping

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

from src.gateway.auth import AuthContext, require_auth
from src.gateway.ownership import can_access_thread, delete_thread_owner, filter_accessible_threads, record_thread_owner

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/langgraph", tags=["langgraph"])

HOP_BY_HOP_HEADERS = {
    "connection",
    "content-length",
    "host",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


def _get_langgraph_upstream_url() -> str:
    configured = os.getenv("LANGGRAPH_UPSTREAM_URL")
    if configured:
        return configured.rstrip("/")
    if os.path.exists("/.dockerenv"):
        return "http://langgraph:2024"
    return "http://localhost:2024"


def _copy_request_headers(request: Request) -> dict[str, str]:
    forwarded: dict[str, str] = {}
    for key, value in request.headers.items():
        lowered = key.lower()
        if lowered in HOP_BY_HOP_HEADERS or lowered == "authorization":
            continue
        forwarded[key] = value
    return forwarded


def _copy_response_headers(headers: Mapping[str, str]) -> dict[str, str]:
    copied: dict[str, str] = {}
    for key, value in headers.items():
        if key.lower() not in HOP_BY_HOP_HEADERS:
            copied[key] = value
    return copied


def _split_path(path: str) -> list[str]:
    return [segment for segment in path.split("/") if segment]


def _extract_thread_id(path: str) -> str | None:
    parts = _split_path(path)
    if len(parts) >= 2 and parts[0] == "threads" and parts[1] != "search":
        return parts[1]
    return None


def _is_thread_create(path: str, method: str) -> bool:
    return method == "POST" and _split_path(path) == ["threads"]


def _is_thread_search(path: str, method: str) -> bool:
    return method == "POST" and _split_path(path) == ["threads", "search"]


def _is_thread_delete(path: str, method: str) -> bool:
    parts = _split_path(path)
    return method == "DELETE" and len(parts) == 2 and parts[0] == "threads"


def _is_run_request(path: str, method: str) -> bool:
    parts = _split_path(path)
    return method == "POST" and len(parts) >= 4 and parts[0] == "threads" and parts[2] == "runs"


def _is_streaming_request(path: str, request: Request) -> bool:
    accept = request.headers.get("accept", "")
    return path.endswith("/runs/stream") or "text/event-stream" in accept


def _inject_auth_context(payload: object, thread_id: str, auth: AuthContext) -> bytes:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Run payload must be a JSON object")

    context = payload.setdefault("context", {})
    if not isinstance(context, dict):
        raise HTTPException(status_code=400, detail="Run context must be a JSON object")
    context.update(
        {
            "thread_id": thread_id,
            "user_id": auth.user_id,
            "email": auth.email,
            "is_admin": auth.is_admin,
        }
    )

    return json.dumps(payload).encode("utf-8")


def _filter_search_payload(payload: object, auth: AuthContext) -> object:
    if isinstance(payload, list):
        return filter_accessible_threads(payload, auth)
    if isinstance(payload, dict):
        filtered = dict(payload)
        for key in ("items", "threads", "data"):
            value = filtered.get(key)
            if isinstance(value, list):
                filtered[key] = filter_accessible_threads(value, auth)
        return filtered
    return payload


async def _read_request_content(request: Request, path: str, auth: AuthContext) -> bytes | None:
    body = await request.body()
    if not body:
        return None

    if not _is_run_request(path, request.method):
        return body

    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid JSON run payload") from exc

    thread_id = _extract_thread_id(path)
    if thread_id is None:
        return body
    return _inject_auth_context(payload, thread_id, auth)


def _upstream_url(path: str) -> str:
    base = _get_langgraph_upstream_url()
    if not path:
        return base
    return f"{base}/{path}"


async def _proxy_stream(request: Request, path: str, content: bytes | None) -> StreamingResponse:
    client = httpx.AsyncClient(timeout=None)
    try:
        upstream = await client.request(
            request.method,
            _upstream_url(path),
            params=list(request.query_params.multi_items()),
            headers=_copy_request_headers(request),
            content=content,
            follow_redirects=False,
            stream=True,
        )
    except TypeError:
        request_obj = client.build_request(
            request.method,
            _upstream_url(path),
            params=list(request.query_params.multi_items()),
            headers=_copy_request_headers(request),
            content=content,
        )
        upstream = await client.send(request_obj, follow_redirects=False, stream=True)
    except httpx.HTTPError as exc:
        await client.aclose()
        logger.exception("LangGraph upstream stream request failed: %s", exc)
        raise HTTPException(status_code=502, detail="LangGraph upstream unavailable") from exc

    return StreamingResponse(
        upstream.aiter_raw(),
        status_code=upstream.status_code,
        headers=_copy_response_headers(upstream.headers),
        background=BackgroundTask(_close_stream, upstream, client),
    )


async def _close_stream(upstream: httpx.Response, client: httpx.AsyncClient) -> None:
    await upstream.aclose()
    await client.aclose()


async def _proxy_request(request: Request, path: str, content: bytes | None) -> httpx.Response:
    try:
        async with httpx.AsyncClient(timeout=None) as client:
            return await client.request(
                request.method,
                _upstream_url(path),
                params=list(request.query_params.multi_items()),
                headers=_copy_request_headers(request),
                content=content,
                follow_redirects=False,
            )
    except httpx.HTTPError as exc:
        logger.exception("LangGraph upstream request failed: %s", exc)
        raise HTTPException(status_code=502, detail="LangGraph upstream unavailable") from exc


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy_langgraph(path: str, request: Request, auth: AuthContext = Depends(require_auth)) -> Response:
    thread_id = _extract_thread_id(path)
    if thread_id is not None and not can_access_thread(thread_id, auth):
        raise HTTPException(status_code=404, detail="Thread not found")

    content = await _read_request_content(request, path, auth)

    if _is_streaming_request(path, request):
        return await _proxy_stream(request, path, content)

    upstream = await _proxy_request(request, path, content)
    headers = _copy_response_headers(upstream.headers)

    if _is_thread_create(path, request.method):
        try:
            payload = upstream.json()
        except ValueError:
            return Response(content=upstream.content, status_code=upstream.status_code, headers=headers)

        if upstream.is_success and isinstance(payload, dict) and isinstance(payload.get("thread_id"), str):
            record_thread_owner(payload["thread_id"], auth.user_id)
        return JSONResponse(content=payload, status_code=upstream.status_code, headers=headers)

    if _is_thread_search(path, request.method):
        try:
            payload = upstream.json()
        except ValueError:
            return Response(content=upstream.content, status_code=upstream.status_code, headers=headers)
        filtered = _filter_search_payload(payload, auth)
        return JSONResponse(content=filtered, status_code=upstream.status_code, headers=headers)

    if _is_thread_delete(path, request.method) and upstream.is_success and thread_id is not None:
        delete_thread_owner(thread_id)

    return Response(content=upstream.content, status_code=upstream.status_code, headers=headers)
