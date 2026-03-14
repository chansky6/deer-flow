"""In-process LangGraph-compatible API routes."""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from src.gateway.auth import AuthContext, require_auth
from src.gateway.ownership import can_access_thread
from src.runtime import get_monolith_runtime

router = APIRouter(prefix="/api/langgraph", tags=["langgraph"])
_CHAT_IN_PROGRESS_MESSAGE = "The chat is in progress!"


def _encode_sse(event: dict[str, Any]) -> bytes:
    lines: list[str] = []
    event_id = event.get("id")
    if event_id is not None:
        lines.append(f"id: {event_id}")
    event_name = event.get("event")
    if event_name:
        lines.append(f"event: {event_name}")
    payload = json.dumps(event.get("data"), ensure_ascii=False)
    for line in payload.splitlines() or ["null"]:
        lines.append(f"data: {line}")
    return ("\n".join(lines) + "\n\n").encode("utf-8")


def _ensure_thread_access(thread_id: str, auth: AuthContext) -> None:
    if not can_access_thread(thread_id, auth):
        raise HTTPException(status_code=404, detail="Thread not found")


def _raise_conflict_error() -> None:
    raise HTTPException(status_code=409, detail=_CHAT_IN_PROGRESS_MESSAGE)


@router.post("/threads")
async def create_thread(
    payload: dict[str, Any] = Body(default_factory=dict),
    auth: AuthContext = Depends(require_auth),
) -> dict[str, Any]:
    runtime = get_monolith_runtime()
    thread = await runtime.create_thread(
        thread_id=payload.get("thread_id"),
        metadata=payload.get("metadata"),
        auth=auth,
        assistant_id=str(payload.get("assistant_id") or "lead_agent"),
    )
    return thread


@router.post("/threads/search")
async def search_threads(
    payload: dict[str, Any] = Body(default_factory=dict),
    auth: AuthContext = Depends(require_auth),
) -> list[dict[str, Any]]:
    runtime = get_monolith_runtime()
    return await runtime.search_threads(payload, auth)


@router.delete("/threads/{thread_id}")
async def delete_thread(thread_id: str, auth: AuthContext = Depends(require_auth)) -> dict[str, Any]:
    _ensure_thread_access(thread_id, auth)
    runtime = get_monolith_runtime()
    await runtime.delete_thread(thread_id)
    return {"ok": True}


@router.get("/threads/{thread_id}/state")
async def get_thread_state(thread_id: str, auth: AuthContext = Depends(require_auth)) -> dict[str, Any]:
    _ensure_thread_access(thread_id, auth)
    runtime = get_monolith_runtime()
    return await runtime.get_state(thread_id)


@router.post("/threads/{thread_id}/state")
async def update_thread_state(
    thread_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    auth: AuthContext = Depends(require_auth),
) -> dict[str, Any]:
    _ensure_thread_access(thread_id, auth)
    runtime = get_monolith_runtime()
    return await runtime.update_state(thread_id, payload, auth)


@router.patch("/threads/{thread_id}/state")
async def patch_thread_state(
    thread_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    auth: AuthContext = Depends(require_auth),
) -> dict[str, Any]:
    _ensure_thread_access(thread_id, auth)
    runtime = get_monolith_runtime()
    thread = await runtime.patch_thread_metadata(thread_id, payload.get("metadata") or {}, auth)
    return thread


@router.post("/threads/{thread_id}/history")
async def get_thread_history(
    thread_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    auth: AuthContext = Depends(require_auth),
) -> list[dict[str, Any]]:
    _ensure_thread_access(thread_id, auth)
    runtime = get_monolith_runtime()
    return await runtime.get_history(thread_id, limit=int(payload.get("limit", 10) or 10))


async def _stream_run_response(stream: AsyncGenerator[dict[str, Any], None]) -> AsyncGenerator[bytes, None]:
    async for event in stream:
        yield _encode_sse(event)


@router.post("/threads/{thread_id}/runs/stream")
async def stream_thread_run(
    thread_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    auth: AuthContext = Depends(require_auth),
) -> StreamingResponse:
    if can_access_thread(thread_id, auth) is False:
        # New threads are created lazily on first run. Existing foreign threads stay hidden.
        existing_thread = await get_monolith_runtime().get_thread(thread_id)
        if existing_thread is not None:
            raise HTTPException(status_code=404, detail="Thread not found")

    runtime = get_monolith_runtime()
    try:
        active_run, headers = await runtime.start_run(thread_id=thread_id, payload=payload, auth=auth)
    except RuntimeError as exc:
        _raise_conflict_error()

    stream = runtime.stream_run_events(run_id=active_run.run_id)
    return StreamingResponse(
        _stream_run_response(stream),
        media_type="text/event-stream",
        headers=headers,
    )


@router.post("/threads/{thread_id}/runs/wait")
async def wait_for_thread_run(
    thread_id: str,
    payload: dict[str, Any] = Body(default_factory=dict),
    auth: AuthContext = Depends(require_auth),
) -> JSONResponse:
    if can_access_thread(thread_id, auth) is False:
        existing_thread = await get_monolith_runtime().get_thread(thread_id)
        if existing_thread is not None:
            raise HTTPException(status_code=404, detail="Thread not found")

    runtime = get_monolith_runtime()
    try:
        result, headers = await runtime.run_and_wait(thread_id=thread_id, payload=payload, auth=auth)
    except RuntimeError as exc:
        _raise_conflict_error()
    return JSONResponse(content=result, headers=headers)


@router.get("/threads/{thread_id}/runs/{run_id}/stream")
async def join_thread_run_stream(
    thread_id: str,
    run_id: str,
    request: Request,
    auth: AuthContext = Depends(require_auth),
) -> StreamingResponse:
    _ensure_thread_access(thread_id, auth)
    runtime = get_monolith_runtime()
    stream = runtime.stream_run_events(
        run_id=run_id,
        after_event_id=request.headers.get("Last-Event-ID"),
    )
    return StreamingResponse(_stream_run_response(stream), media_type="text/event-stream")


@router.post("/threads/{thread_id}/runs/{run_id}/cancel")
async def cancel_thread_run(
    thread_id: str,
    run_id: str,
    auth: AuthContext = Depends(require_auth),
) -> dict[str, Any]:
    _ensure_thread_access(thread_id, auth)
    runtime = get_monolith_runtime()
    try:
        return await runtime.cancel_run(thread_id, run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Run not found") from exc


@router.get("/threads/{thread_id}/runs/{run_id}/join")
async def join_thread_run(
    thread_id: str,
    run_id: str,
    auth: AuthContext = Depends(require_auth),
) -> dict[str, Any]:
    _ensure_thread_access(thread_id, auth)
    runtime = get_monolith_runtime()
    try:
        return await runtime.join_run(thread_id, run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Run not found") from exc


@router.get("/threads/{thread_id}/runs/{run_id}")
async def get_thread_run(
    thread_id: str,
    run_id: str,
    auth: AuthContext = Depends(require_auth),
) -> dict[str, Any]:
    _ensure_thread_access(thread_id, auth)
    run = await get_monolith_runtime().get_run(run_id)
    if run is None or run["thread_id"] != thread_id:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def unsupported_langgraph_route(path: str) -> Response:
    raise HTTPException(status_code=404, detail=f"Unsupported LangGraph API path: {path}")
