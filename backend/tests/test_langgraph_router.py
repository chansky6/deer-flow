from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from src.gateway.auth import AuthContext, require_auth
from src.gateway.routers import langgraph


def _make_auth() -> AuthContext:
    return AuthContext(
        user_id="user-1",
        email="user@example.com",
        is_admin=False,
        session_id="test-session",
    )


def _single_event_stream():
    async def _stream():
        yield {"id": "1", "event": "values", "data": {"messages": []}}

    return _stream()


def _make_client() -> TestClient:
    app = FastAPI()
    app.include_router(langgraph.router)

    async def _require_auth_override() -> AuthContext:
        return _make_auth()

    app.dependency_overrides[require_auth] = _require_auth_override
    return TestClient(app)


def test_stream_run_allows_lazy_thread_creation_and_preserves_headers():
    runtime = SimpleNamespace(
        get_thread=AsyncMock(return_value=None),
        start_run=AsyncMock(
            return_value=(
                SimpleNamespace(run_id="run-1"),
                {
                    "Content-Location": "/threads/thread-1/runs/run-1",
                    "Location": "/threads/thread-1/runs/run-1/stream",
                },
            )
        ),
        stream_run_events=MagicMock(return_value=_single_event_stream()),
    )

    with (
        _make_client() as client,
        patch.object(langgraph, "can_access_thread", return_value=False),
        patch.object(langgraph, "get_monolith_runtime", return_value=runtime),
    ):
        response = client.post("/api/langgraph/threads/thread-1/runs/stream", json={})

    assert response.status_code == 200
    assert response.headers["content-location"] == "/threads/thread-1/runs/run-1"
    assert response.headers["location"] == "/threads/thread-1/runs/run-1/stream"
    assert "event: values" in response.text
    runtime.start_run.assert_awaited_once()


def test_stream_run_rejects_inaccessible_existing_thread():
    runtime = SimpleNamespace(
        get_thread=AsyncMock(return_value={"thread_id": "thread-1"}),
        start_run=AsyncMock(),
    )

    with (
        _make_client() as client,
        patch.object(langgraph, "can_access_thread", return_value=False),
        patch.object(langgraph, "get_monolith_runtime", return_value=runtime),
    ):
        response = client.post("/api/langgraph/threads/thread-1/runs/stream", json={})

    assert response.status_code == 404
    runtime.start_run.assert_not_awaited()


def test_get_run_returns_run_metadata():
    runtime = SimpleNamespace(
        get_run=AsyncMock(
            return_value={
                "run_id": "run-1",
                "thread_id": "thread-1",
                "status": "success",
            }
        )
    )

    with (
        _make_client() as client,
        patch.object(langgraph, "can_access_thread", return_value=True),
        patch.object(langgraph, "get_monolith_runtime", return_value=runtime),
    ):
        response = client.get("/api/langgraph/threads/thread-1/runs/run-1")

    assert response.status_code == 200
    assert response.json() == {
        "run_id": "run-1",
        "thread_id": "thread-1",
        "status": "success",
    }
