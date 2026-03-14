import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from src.runtime.service import ActiveRun, MonolithRuntime


class _FakeAsyncContextManager:
    def __init__(self, value):
        self.value = value
        self.enter_calls = 0
        self.exit_calls = 0

    async def __aenter__(self):
        self.enter_calls += 1
        return self.value

    async def __aexit__(self, exc_type, exc, tb):
        self.exit_calls += 1
        return False


class _FakeMessageChunk:
    def __init__(self, *, content: str, message_id: str) -> None:
        self._payload = {
            "type": "AIMessageChunk",
            "content": content,
            "id": message_id,
        }

    def model_dump(self) -> dict[str, str]:
        return dict(self._payload)


class _FakeGraph:
    def __init__(self, events):
        self.events = list(events)
        self.calls: list[tuple[object, dict[str, object]]] = []

    def astream(self, input_payload, **kwargs):
        self.calls.append((input_payload, kwargs))

        async def _stream():
            for event in self.events:
                yield event

        return _stream()


def _make_auth() -> SimpleNamespace:
    return SimpleNamespace(user_id="user-1", email="user@example.com", is_admin=False)


def test_ensure_ready_opens_async_checkpointer_once():
    runtime = MonolithRuntime()
    checkpointer = MagicMock()
    context_manager = _FakeAsyncContextManager(checkpointer)

    with (
        patch("src.runtime.service.make_checkpointer", return_value=context_manager) as make_cp,
        patch("src.runtime.service.repository.ensure_runtime_schema") as ensure_schema,
    ):
        asyncio.run(runtime.ensure_ready())
        asyncio.run(runtime.ensure_ready())

    assert runtime._checkpointer is checkpointer
    assert runtime._ready is True
    assert context_manager.enter_calls == 1
    make_cp.assert_called_once()
    ensure_schema.assert_called_once()


def test_close_releases_async_checkpointer_and_clears_runtime_state():
    runtime = MonolithRuntime()
    checkpointer = MagicMock()
    context_manager = _FakeAsyncContextManager(checkpointer)

    with (
        patch("src.runtime.service.make_checkpointer", return_value=context_manager),
        patch("src.runtime.service.repository.ensure_runtime_schema"),
    ):
        asyncio.run(runtime.ensure_ready())
        asyncio.run(runtime.close())

    assert runtime._checkpointer is None
    assert runtime._checkpointer_cm is None
    assert runtime._ready is False
    assert context_manager.exit_calls == 1


def test_start_run_persists_pending_run_request():
    runtime = MonolithRuntime()
    runtime._ready = True
    auth = _make_auth()
    thread = {
        "thread_id": "thread-1",
        "assistant_id": "lead_agent",
        "metadata": {"topic": "demo"},
        "values": {"messages": []},
        "interrupts": {},
    }

    with (
        patch.object(runtime, "ensure_ready", AsyncMock()),
        patch.object(runtime, "get_thread", AsyncMock(return_value=thread)),
        patch("src.runtime.service.repository.upsert_thread") as upsert_thread,
        patch("src.runtime.service.repository.create_pending_run") as create_pending_run,
    ):
        active, headers = asyncio.run(
            runtime.start_run(
                thread_id="thread-1",
                payload={
                    "input": {"messages": [{"role": "user", "content": "hi"}]},
                    "config": {"recursion_limit": 5},
                    "context": {"model_name": "gpt-test"},
                    "stream_mode": ["messages"],
                    "metadata": {"request_id": "req-1"},
                },
                auth=auth,
            )
        )

    assert active.thread_id == "thread-1"
    assert active.assistant_id == "lead_agent"
    assert active.requested_modes == ["messages", "values"]
    assert headers == {
        "Content-Location": f"/threads/thread-1/runs/{active.run_id}",
        "Location": f"/threads/thread-1/runs/{active.run_id}/stream",
    }
    upsert_thread.assert_called_once()

    args, kwargs = create_pending_run.call_args
    assert args[0] == active.run_id
    assert kwargs["thread_id"] == "thread-1"
    assert kwargs["assistant_id"] == "lead_agent"
    assert kwargs["metadata"] == {"request_id": "req-1"}
    assert kwargs["request"] == {
        "input": {"messages": [{"type": "human", "content": "hi"}]},
        "config": {"recursion_limit": 5},
        "context": {"model_name": "gpt-test"},
        "stream_mode": ["messages", "values"],
        "stream_subgraphs": False,
        "assistant_id": "lead_agent",
        "metadata": {"request_id": "req-1"},
        "multitask_strategy": None,
        "auth": {
            "user_id": "user-1",
            "email": "user@example.com",
            "is_admin": False,
        },
    }


def test_stream_run_events_polls_database_until_terminal():
    runtime = MonolithRuntime()
    runtime._ready = True
    observed: list[dict[str, object]] = []

    async def _consume() -> None:
        async for item in runtime.stream_run_events(run_id="run-1"):
            observed.append(item)

    with (
        patch(
            "src.runtime.service.repository.list_run_events",
            side_effect=[
                [{"id": "1", "event": "messages", "data": ["Hel", {}]}],
                [],
                [{"id": "2", "event": "messages", "data": ["lo", {}]}],
                [],
            ],
        ) as list_events,
        patch(
            "src.runtime.service.repository.get_run_control",
            side_effect=[
                {"run_id": "run-1", "status": "running", "cancel_requested": False},
                {"run_id": "run-1", "status": "success", "cancel_requested": False},
            ],
        ) as get_control,
        patch("src.runtime.service.asyncio.sleep", new=AsyncMock()) as sleep_mock,
    ):
        asyncio.run(_consume())

    assert observed == [
        {"id": "1", "event": "messages", "data": ["Hel", {}]},
        {"id": "2", "event": "messages", "data": ["lo", {}]},
    ]
    assert list_events.call_count == 4
    assert get_control.call_count == 2
    sleep_mock.assert_awaited_once()


def test_cancel_pending_run_interrupts_without_runner():
    runtime = MonolithRuntime()
    runtime._ready = True
    auth = _make_auth()
    order: list[str] = []

    def _record_update(*args, **kwargs):
        order.append("update")
        return {
            "run_id": "run-1",
            "thread_id": "thread-1",
            "assistant_id": "lead_agent",
            "status": "interrupted",
            "error": {"error": "RunInterrupted", "message": "Run cancelled"},
        }

    async def _record_publish(*args, **kwargs):
        order.append("publish")

    with (
        patch(
            "src.runtime.service.repository.get_run",
            return_value={
                "run_id": "run-1",
                "thread_id": "thread-1",
                "assistant_id": "lead_agent",
                "status": "pending",
            },
        ),
        patch(
            "src.runtime.service.repository.mark_run_cancel_requested",
            return_value={
                "run_id": "run-1",
                "thread_id": "thread-1",
                "assistant_id": "lead_agent",
                "status": "pending",
                "cancel_requested": True,
            },
        ),
        patch("src.runtime.service.repository.update_run_status", side_effect=_record_update) as update_status,
        patch.object(runtime, "_publish_event", side_effect=_record_publish) as publish_event,
        patch.object(runtime, "get_thread", AsyncMock(return_value={"assistant_id": "lead_agent", "values": {"messages": []}})),
        patch.object(runtime, "_persist_thread_values", AsyncMock(return_value={})),
    ):
        result = asyncio.run(runtime.cancel_run("thread-1", "run-1"))

    assert order == ["publish", "update"]
    assert result["status"] == "interrupted"
    publish_event.assert_awaited_once()
    update_status.assert_called_once_with(
        "run-1",
        status="interrupted",
        error={"error": "RunInterrupted", "message": "Run cancelled"},
    )


def test_execute_claimed_run_reads_request_auth_and_stream_modes():
    runtime = MonolithRuntime()
    runtime._ready = True
    claimed_run = {
        "run_id": "run-1",
        "thread_id": "thread-1",
        "assistant_id": "lead_agent",
        "request": {
            "input": {"messages": [{"type": "human", "content": "hello"}]},
            "config": {"recursion_limit": 7},
            "context": {"model_name": "gpt-test"},
            "stream_mode": ["messages"],
            "assistant_id": "lead_agent",
            "auth": {
                "user_id": "user-42",
                "email": "runner@example.com",
                "is_admin": True,
            },
        },
    }

    with (
        patch.object(runtime, "ensure_ready", AsyncMock()),
        patch.object(runtime, "_execute_run", AsyncMock()) as execute_run,
    ):
        asyncio.run(runtime.execute_claimed_run(claimed_run))

    active = execute_run.await_args.args[0]
    payload = execute_run.await_args.args[1]
    auth = execute_run.await_args.args[2]

    assert isinstance(active, ActiveRun)
    assert active.run_id == "run-1"
    assert active.thread_id == "thread-1"
    assert active.requested_modes == ["messages", "values"]
    assert payload == claimed_run["request"]
    assert auth.user_id == "user-42"
    assert auth.email == "runner@example.com"
    assert auth.is_admin is True


def test_execute_run_emits_messages_events_for_messages_tuple_mode():
    runtime = MonolithRuntime()
    runtime._ready = True
    runtime._checkpointer = MagicMock()

    graph = _FakeGraph(
        [
            (
                "messages",
                (
                    _FakeMessageChunk(content="Hel", message_id="msg-1"),
                    {"langgraph_checkpoint_ns": ""},
                ),
            ),
            (
                "messages",
                (
                    _FakeMessageChunk(content="lo", message_id="msg-1"),
                    {"langgraph_checkpoint_ns": ""},
                ),
            ),
            ("values", {"messages": [{"type": "ai", "content": "Hello", "id": "msg-1"}]}),
        ]
    )
    active = ActiveRun(
        run_id="run-1",
        thread_id="thread-1",
        assistant_id="lead_agent",
        requested_modes=["values", "messages-tuple"],
    )
    auth = _make_auth()
    published: list[dict[str, object]] = []

    async def _capture_publish(_active, *, event_name, data, namespace=None):
        published.append({"event": event_name, "data": data, "namespace": namespace})

    with (
        patch.object(runtime._agents, "get", return_value=graph),
        patch.object(runtime, "_publish_event", side_effect=_capture_publish),
        patch("src.runtime.service.repository.get_run_control", return_value={"status": "running", "cancel_requested": False}),
        patch.object(
            runtime,
            "_snapshot_graph_state",
            AsyncMock(
                return_value={
                    "values": {"messages": [{"type": "ai", "content": "Hello", "id": "msg-1"}]},
                    "next": [],
                    "checkpoint": {"checkpoint_id": "cp-1"},
                    "metadata": None,
                    "parent_checkpoint": None,
                    "tasks": [],
                }
            ),
        ),
        patch("src.runtime.service.repository.save_thread_state"),
        patch.object(runtime, "_persist_thread_values", AsyncMock(return_value={})),
        patch("src.runtime.service.repository.update_run_status"),
    ):
        asyncio.run(
            runtime._execute_run(
                active,
                {"input": {"messages": [{"role": "user", "content": "hi"}]}},
                auth,
            )
        )

    assert graph.calls[0][0] == {"messages": [{"type": "human", "content": "hi"}]}
    assert graph.calls[0][1]["stream_mode"] == ["values", "messages"]
    assert [event["event"] for event in published] == ["messages", "messages", "values"]
    assert published[0]["data"] == [
        {"type": "AIMessageChunk", "content": "Hel", "id": "msg-1"},
        {"langgraph_checkpoint_ns": ""},
    ]
    assert published[1]["data"] == [
        {"type": "AIMessageChunk", "content": "lo", "id": "msg-1"},
        {"langgraph_checkpoint_ns": ""},
    ]
    assert active.final_values == {
        "messages": [{"type": "ai", "content": "Hello", "id": "msg-1"}]
    }
