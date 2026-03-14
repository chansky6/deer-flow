"""In-process LangGraph-compatible runtime for the monolith backend."""

from __future__ import annotations

import asyncio
import logging
import threading
import uuid
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

from fastapi.encoders import jsonable_encoder
from langchain.agents import create_agent
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableConfig

from src.agents.checkpointer import make_checkpointer
from src.agents.lead_agent.agent import _build_middlewares, _resolve_model_name
from src.agents.lead_agent.prompt import apply_prompt_template
from src.agents.thread_state import ThreadState
from src.config.agents_config import load_agent_config
from src.config.app_config import get_app_config
from src.models import create_chat_model
from src.tools import get_available_tools
from src.tools.builtins import setup_agent

from . import repository

logger = logging.getLogger(__name__)
_TERMINAL_RUN_STATUSES = {"success", "error", "interrupted", "timeout"}


class RunInterrupted(RuntimeError):
    """Raised when a running task is cancelled by user intent."""


def _serialize_message(message: BaseMessage) -> dict[str, Any]:
    if isinstance(message, AIMessage):
        payload: dict[str, Any] = {
            "type": "ai",
            "content": message.content,
            "id": getattr(message, "id", None),
        }
        if message.tool_calls:
            payload["tool_calls"] = [
                {
                    "name": tool_call["name"],
                    "args": tool_call["args"],
                    "id": tool_call.get("id"),
                }
                for tool_call in message.tool_calls
            ]
        return payload
    if isinstance(message, ToolMessage):
        payload = {
            "type": "tool",
            "content": message.content if isinstance(message.content, str) else str(message.content),
            "name": getattr(message, "name", None),
            "tool_call_id": getattr(message, "tool_call_id", None),
            "id": getattr(message, "id", None),
        }
        status = getattr(message, "status", None)
        if status is not None:
            payload["status"] = status
        return payload
    if isinstance(message, HumanMessage):
        return {"type": "human", "content": message.content, "id": getattr(message, "id", None)}
    if isinstance(message, SystemMessage):
        return {"type": "system", "content": message.content, "id": getattr(message, "id", None)}
    return {"type": "unknown", "content": str(message), "id": getattr(message, "id", None)}


def _normalize_payload(value: Any) -> Any:
    if isinstance(value, BaseMessage):
        return _serialize_message(value)
    if isinstance(value, dict):
        return {key: _normalize_payload(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_normalize_payload(item) for item in value]
    if isinstance(value, tuple):
        return [_normalize_payload(item) for item in value]
    if hasattr(value, "model_dump"):
        try:
            return _normalize_payload(value.model_dump())
        except TypeError:
            pass
    return jsonable_encoder(value)


def _normalize_stream_message(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        try:
            return jsonable_encoder(value.model_dump())
        except TypeError:
            pass
    if isinstance(value, BaseMessage):
        return _serialize_message(value)
    return jsonable_encoder(value)


def _normalize_message_inputs(value: Any) -> Any:
    if not isinstance(value, dict):
        return value

    messages = value.get("messages")
    if not isinstance(messages, list):
        return value

    normalized_messages: list[dict[str, Any]] = []
    for message in messages:
        if not isinstance(message, dict):
            normalized_messages.append(message)
            continue
        normalized = dict(message)
        role = normalized.pop("role", None)
        if role is not None and "type" not in normalized:
            normalized["type"] = {
                "user": "human",
                "assistant": "ai",
                "system": "system",
                "tool": "tool",
                "human": "human",
                "ai": "ai",
            }.get(str(role), str(role))
        normalized_messages.append(normalized)

    next_value = dict(value)
    next_value["messages"] = normalized_messages
    return next_value


def _normalize_requested_modes(value: Any) -> list[str]:
    raw_modes = value or ["values"]
    if isinstance(raw_modes, str):
        raw_modes = [raw_modes]

    normalized: list[str] = []
    seen: set[str] = set()
    for raw_mode in raw_modes:
        mode = str(raw_mode)
        if mode not in seen:
            seen.add(mode)
            normalized.append(mode)

    if "values" not in seen:
        normalized.append("values")
    return normalized


def _owner_user_id(auth: Any) -> str | None:
    return None if getattr(auth, "is_admin", False) else getattr(auth, "user_id", None)


def _auth_to_request_payload(auth: Any) -> dict[str, Any]:
    return {
        "user_id": getattr(auth, "user_id", None),
        "email": getattr(auth, "email", None),
        "is_admin": bool(getattr(auth, "is_admin", False)),
    }


def _auth_from_request_payload(payload: dict[str, Any]) -> SimpleNamespace:
    return SimpleNamespace(
        user_id=payload.get("user_id"),
        email=payload.get("email"),
        is_admin=bool(payload.get("is_admin", False)),
    )


def _coerce_state_snapshot(thread_id: str, state: Any) -> dict[str, Any]:
    if state is None:
        return {
            "values": {},
            "next": [],
            "checkpoint": {
                "thread_id": thread_id,
                "checkpoint_ns": "",
                "checkpoint_id": None,
                "checkpoint_map": None,
            },
            "metadata": None,
            "created_at": None,
            "parent_checkpoint": None,
            "tasks": [],
        }

    def read(name: str, default: Any = None) -> Any:
        if isinstance(state, dict):
            return state.get(name, default)
        return getattr(state, name, default)

    checkpoint = _normalize_payload(read("checkpoint")) or {}
    checkpoint.setdefault("thread_id", thread_id)
    checkpoint.setdefault("checkpoint_ns", "")
    checkpoint.setdefault("checkpoint_id", None)
    checkpoint.setdefault("checkpoint_map", None)

    parent_checkpoint = _normalize_payload(read("parent_checkpoint"))
    if isinstance(parent_checkpoint, dict):
        parent_checkpoint.setdefault("thread_id", thread_id)
        parent_checkpoint.setdefault("checkpoint_ns", "")
        parent_checkpoint.setdefault("checkpoint_map", None)

    created_at = read("created_at")
    if created_at is not None:
        created_at = str(created_at)

    return {
        "values": _normalize_payload(read("values", {})) or {},
        "next": list(read("next", []) or []),
        "checkpoint": checkpoint,
        "metadata": _normalize_payload(read("metadata")),
        "created_at": created_at,
        "parent_checkpoint": parent_checkpoint,
        "tasks": _normalize_payload(read("tasks", [])) or [],
    }


@dataclass(frozen=True)
class RuntimeOptions:
    thread_id: str
    user_id: str
    email: str | None
    is_admin: bool
    model_name: str | None = None
    thinking_enabled: bool = True
    is_plan_mode: bool = False
    subagent_enabled: bool = False
    reasoning_effort: str | None = None
    max_concurrent_subagents: int = 3
    agent_name: str | None = None
    is_bootstrap: bool = False


def _runtime_key(options: RuntimeOptions) -> tuple[Any, ...]:
    return (
        options.model_name,
        options.thinking_enabled,
        options.is_plan_mode,
        options.subagent_enabled,
        options.reasoning_effort,
        options.max_concurrent_subagents,
        options.agent_name,
        options.user_id,
        options.is_bootstrap,
    )


def _build_runnable_config(options: RuntimeOptions, config_overrides: dict[str, Any] | None = None) -> RunnableConfig:
    config_overrides = dict(config_overrides or {})
    configurable = dict(config_overrides.pop("configurable", {}) or {})
    configurable.update(
        {
            "thread_id": options.thread_id,
            "model_name": options.model_name,
            "thinking_enabled": options.thinking_enabled,
            "is_plan_mode": options.is_plan_mode,
            "subagent_enabled": options.subagent_enabled,
            "reasoning_effort": options.reasoning_effort,
            "max_concurrent_subagents": options.max_concurrent_subagents,
            "agent_name": options.agent_name,
            "user_id": options.user_id,
            "is_bootstrap": options.is_bootstrap,
        }
    )
    metadata = dict(config_overrides.pop("metadata", {}) or {})
    return RunnableConfig(
        configurable=configurable,
        metadata=metadata,
        recursion_limit=int(config_overrides.pop("recursion_limit", 100)),
        **config_overrides,
    )


def _create_runtime_agent(options: RuntimeOptions, *, checkpointer: Any):
    config = _build_runnable_config(options)
    requested_model_name = options.model_name
    thinking_enabled = options.thinking_enabled
    reasoning_effort = options.reasoning_effort
    subagent_enabled = options.subagent_enabled
    max_concurrent_subagents = options.max_concurrent_subagents
    agent_name = options.agent_name
    user_id = options.user_id
    is_bootstrap = options.is_bootstrap

    agent_config = load_agent_config(agent_name) if agent_name and not is_bootstrap else None
    app_config = get_app_config()

    default_model_name = app_config.models[0].name if app_config.models else None
    if default_model_name is None:
        raise ValueError("No chat models are configured. Please configure at least one model in config.yaml.")

    agent_model_name = agent_config.model if agent_config and agent_config.model else _resolve_model_name()
    model_name = requested_model_name or agent_model_name
    model_config = app_config.get_model_config(model_name) if model_name else None
    if model_config is None:
        raise ValueError("No chat model could be resolved. Please configure at least one model in config.yaml.")
    if thinking_enabled and not model_config.supports_thinking:
        logger.warning("Thinking mode is enabled but model '%s' does not support it; disabling thinking.", model_name)
        thinking_enabled = False

    config["metadata"].update(
        {
            "agent_name": agent_name or "default",
            "model_name": model_name,
            "thinking_enabled": thinking_enabled,
            "reasoning_effort": reasoning_effort,
            "is_plan_mode": options.is_plan_mode,
            "subagent_enabled": subagent_enabled,
        }
    )

    kwargs: dict[str, Any] = {
        "middleware": _build_middlewares(config, model_name=model_name, agent_name=agent_name if not is_bootstrap else None),
        "state_schema": ThreadState,
    }
    if checkpointer is not None:
        kwargs["checkpointer"] = checkpointer

    if is_bootstrap:
        kwargs.update(
            {
                "model": create_chat_model(name=model_name, thinking_enabled=thinking_enabled),
                "tools": get_available_tools(model_name=model_name, subagent_enabled=subagent_enabled) + [setup_agent],
                "system_prompt": apply_prompt_template(
                    subagent_enabled=subagent_enabled,
                    max_concurrent_subagents=max_concurrent_subagents,
                    available_skills={"bootstrap"},
                    user_id=user_id,
                ),
            }
        )
    else:
        kwargs.update(
            {
                "model": create_chat_model(
                    name=model_name,
                    thinking_enabled=thinking_enabled,
                    reasoning_effort=reasoning_effort,
                ),
                "tools": get_available_tools(
                    model_name=model_name,
                    groups=agent_config.tool_groups if agent_config else None,
                    subagent_enabled=subagent_enabled,
                ),
                "system_prompt": apply_prompt_template(
                    subagent_enabled=subagent_enabled,
                    max_concurrent_subagents=max_concurrent_subagents,
                    agent_name=agent_name,
                    user_id=user_id,
                ),
            }
        )

    return create_agent(**kwargs)


class _AgentRegistry:
    def __init__(self) -> None:
        self._agents: dict[tuple[Any, ...], Any] = {}
        self._lock = threading.RLock()

    def get(self, options: RuntimeOptions, *, checkpointer: Any):
        key = _runtime_key(options)
        with self._lock:
            agent = self._agents.get(key)
            if agent is None:
                agent = _create_runtime_agent(options, checkpointer=checkpointer)
                self._agents[key] = agent
            return agent

    def clear(self) -> None:
        with self._lock:
            self._agents.clear()


@dataclass
class ActiveRun:
    run_id: str
    thread_id: str
    assistant_id: str
    requested_modes: list[str]
    final_values: dict[str, Any] | None = None
    error_payload: dict[str, Any] | None = None


class MonolithRuntime:
    def __init__(self) -> None:
        self._agents = _AgentRegistry()
        self._ready = False
        self._ready_lock = asyncio.Lock()
        self._checkpointer: Any = None
        self._checkpointer_cm: Any = None

    async def ensure_ready(self) -> None:
        if self._ready:
            return

        async with self._ready_lock:
            if self._ready:
                return
            await asyncio.to_thread(repository.ensure_runtime_schema)
            if self._checkpointer_cm is None:
                self._checkpointer_cm = make_checkpointer()
                self._checkpointer = await self._checkpointer_cm.__aenter__()
            self._ready = True

    async def close(self) -> None:
        async with self._ready_lock:
            checkpointer_cm = self._checkpointer_cm
            self._checkpointer_cm = None
            self._checkpointer = None
            self._ready = False
            self._agents.clear()

        if checkpointer_cm is not None:
            await checkpointer_cm.__aexit__(None, None, None)

    def _options_from_context(self, thread_id: str, context: dict[str, Any], auth: Any) -> RuntimeOptions:
        return RuntimeOptions(
            thread_id=thread_id,
            user_id=auth.user_id,
            email=auth.email,
            is_admin=auth.is_admin,
            model_name=context.get("model_name"),
            thinking_enabled=bool(context.get("thinking_enabled", True)),
            is_plan_mode=bool(context.get("is_plan_mode", False)),
            subagent_enabled=bool(context.get("subagent_enabled", False)),
            reasoning_effort=context.get("reasoning_effort"),
            max_concurrent_subagents=int(context.get("max_concurrent_subagents", 3) or 3),
            agent_name=context.get("agent_name"),
            is_bootstrap=bool(context.get("is_bootstrap", False)),
        )

    async def create_thread(
        self,
        *,
        thread_id: str | None,
        metadata: dict[str, Any] | None,
        auth: Any,
        assistant_id: str = "lead_agent",
    ) -> dict[str, Any]:
        await self.ensure_ready()
        thread_id = thread_id or str(uuid.uuid4())
        thread = await asyncio.to_thread(
            repository.upsert_thread,
            thread_id,
            owner_user_id=auth.user_id,
            assistant_id=assistant_id,
            metadata=metadata or {},
            status="idle",
            values_cache={},
            interrupts={},
        )
        await asyncio.to_thread(
            repository.save_thread_state,
            thread_id,
            checkpoint_id="root",
            parent_checkpoint_id=None,
            values={},
            next_nodes=[],
            metadata={"source": "input"},
            tasks=[],
        )
        return thread

    async def search_threads(self, payload: dict[str, Any], auth: Any) -> list[dict[str, Any]]:
        await self.ensure_ready()
        return await asyncio.to_thread(
            repository.list_threads,
            user_id=auth.user_id,
            is_admin=auth.is_admin,
            ids=payload.get("ids"),
            metadata=payload.get("metadata"),
            values=payload.get("values"),
            status=payload.get("status"),
            limit=int(payload.get("limit", 50) or 50),
            offset=int(payload.get("offset", 0) or 0),
            sort_by=str(payload.get("sort_by") or "updated_at"),
            sort_order=str(payload.get("sort_order") or "desc"),
        )

    async def delete_thread(self, thread_id: str) -> None:
        await self.ensure_ready()
        await asyncio.to_thread(repository.mark_thread_deleted, thread_id)

    async def get_thread(self, thread_id: str) -> dict[str, Any] | None:
        await self.ensure_ready()
        return await asyncio.to_thread(repository.get_thread, thread_id)

    async def get_run(self, run_id: str) -> dict[str, Any] | None:
        await self.ensure_ready()
        return await asyncio.to_thread(repository.get_run, run_id)

    async def get_state(self, thread_id: str) -> dict[str, Any]:
        await self.ensure_ready()
        state = await asyncio.to_thread(repository.get_latest_thread_state, thread_id)
        if state is not None:
            return state

        thread = await asyncio.to_thread(repository.get_thread, thread_id)
        if thread is None:
            return _coerce_state_snapshot(thread_id, None)
        return {
            "values": thread.get("values", {}),
            "next": [],
            "checkpoint": {
                "thread_id": thread_id,
                "checkpoint_ns": "",
                "checkpoint_id": None,
                "checkpoint_map": None,
            },
            "metadata": None,
            "created_at": thread.get("updated_at"),
            "parent_checkpoint": None,
            "tasks": [],
        }

    async def get_history(self, thread_id: str, *, limit: int = 10) -> list[dict[str, Any]]:
        await self.ensure_ready()
        states = await asyncio.to_thread(repository.list_thread_states, thread_id, limit=limit)
        if states:
            return states
        return [await self.get_state(thread_id)]

    async def update_state(self, thread_id: str, payload: dict[str, Any], auth: Any) -> dict[str, Any]:
        await self.ensure_ready()
        context = {
            "model_name": None,
            "thinking_enabled": True,
            "is_plan_mode": False,
            "subagent_enabled": False,
        }
        options = self._options_from_context(thread_id, context, auth)
        graph = self._agents.get(options, checkpointer=self._checkpointer)
        config = _build_runnable_config(options)
        values = _normalize_message_inputs(payload.get("values") or {})

        async_update = getattr(graph, "aupdate_state", None)
        if callable(async_update):
            await async_update(config, values, as_node=payload.get("as_node"))
        else:
            await asyncio.to_thread(graph.update_state, config, values, payload.get("as_node"))

        current_state = None
        async_get_state = getattr(graph, "aget_state", None)
        if callable(async_get_state):
            current_state = await async_get_state(config)
        elif hasattr(graph, "get_state"):
            current_state = await asyncio.to_thread(graph.get_state, config)

        snapshot = _coerce_state_snapshot(thread_id, current_state)
        checkpoint_id = str(snapshot["checkpoint"].get("checkpoint_id") or uuid.uuid4())
        parent_checkpoint_id = None
        parent_checkpoint = snapshot.get("parent_checkpoint")
        if isinstance(parent_checkpoint, dict):
            parent_checkpoint_id = parent_checkpoint.get("checkpoint_id")

        await asyncio.to_thread(
            repository.save_thread_state,
            thread_id,
            checkpoint_id=checkpoint_id,
            parent_checkpoint_id=parent_checkpoint_id,
            values=snapshot["values"],
            next_nodes=snapshot.get("next", []),
            metadata=snapshot.get("metadata"),
            tasks=snapshot.get("tasks", []),
        )
        await asyncio.to_thread(
            repository.upsert_thread,
            thread_id,
            owner_user_id=auth.user_id,
            status="interrupted" if snapshot["values"].get("__interrupt__") else "idle",
            values_cache=snapshot["values"],
            interrupts={},
            metadata=(await self.get_thread(thread_id) or {}).get("metadata", {}),
        )
        return snapshot

    async def patch_thread_metadata(self, thread_id: str, metadata: dict[str, Any], auth: Any) -> dict[str, Any]:
        thread = await self.get_thread(thread_id)
        next_metadata = dict(thread.get("metadata", {}) if thread else {})
        next_metadata.update(metadata)
        return await asyncio.to_thread(
            repository.upsert_thread,
            thread_id,
            owner_user_id=auth.user_id,
            metadata=next_metadata,
            status=(thread or {}).get("status", "idle"),
            values_cache=(thread or {}).get("values", {}),
            interrupts=(thread or {}).get("interrupts", {}),
            error=(thread or {}).get("error"),
        )

    async def _wait_for_run_terminal(self, run_id: str, *, poll_interval: float = 0.2) -> dict[str, Any]:
        while True:
            run = await asyncio.to_thread(repository.get_run, run_id)
            if run is None:
                raise KeyError(run_id)
            if run.get("status") in _TERMINAL_RUN_STATUSES:
                return run
            await asyncio.sleep(poll_interval)

    async def _snapshot_graph_state(
        self,
        graph: Any,
        run_config: RunnableConfig,
        *,
        thread_id: str,
    ) -> dict[str, Any]:
        current_state = None
        async_get_state = getattr(graph, "aget_state", None)
        if callable(async_get_state):
            current_state = await async_get_state(run_config)
        elif hasattr(graph, "get_state"):
            current_state = await asyncio.to_thread(graph.get_state, run_config)
        else:
            return await self.get_state(thread_id)
        return _coerce_state_snapshot(thread_id, current_state)

    async def _persist_thread_values(
        self,
        *,
        thread_id: str,
        auth: Any,
        status: str,
        values: dict[str, Any],
        error: Any,
        assistant_id: str | None = None,
    ) -> dict[str, Any]:
        thread = await self.get_thread(thread_id)
        return await asyncio.to_thread(
            repository.upsert_thread,
            thread_id,
            owner_user_id=_owner_user_id(auth),
            assistant_id=assistant_id or (thread or {}).get("assistant_id") or "lead_agent",
            metadata=(thread or {}).get("metadata", {}),
            status=status,
            values_cache=values,
            interrupts={},
            error=error,
        )

    async def start_run(
        self,
        *,
        thread_id: str,
        payload: dict[str, Any],
        auth: Any,
    ) -> tuple[ActiveRun, dict[str, str]]:
        await self.ensure_ready()
        thread = await self.get_thread(thread_id)
        assistant_id = str(payload.get("assistant_id") or (thread or {}).get("assistant_id") or "lead_agent")

        if thread is None:
            await asyncio.to_thread(
                repository.upsert_thread,
                thread_id,
                owner_user_id=auth.user_id,
                assistant_id=assistant_id,
                metadata={},
                status="busy",
                values_cache={},
                interrupts={},
                error=None,
            )
        else:
            await asyncio.to_thread(
                repository.upsert_thread,
                thread_id,
                owner_user_id=_owner_user_id(auth),
                assistant_id=assistant_id,
                metadata=thread.get("metadata", {}),
                status="busy",
                values_cache=thread.get("values", {}),
                interrupts=thread.get("interrupts", {}),
                error=None,
            )

        requested_modes = _normalize_requested_modes(payload.get("stream_mode"))
        multitask_strategy = payload.get("multitask_strategy")
        run_id = str(uuid.uuid4())
        request_payload = {
            "input": _normalize_payload(_normalize_message_inputs(payload.get("input") or {})),
            "config": _normalize_payload(payload.get("config") or {}),
            "context": _normalize_payload(payload.get("context") or {}),
            "stream_mode": requested_modes,
            "stream_subgraphs": bool(payload.get("stream_subgraphs", False)),
            "assistant_id": assistant_id,
            "metadata": _normalize_payload(payload.get("metadata") or {}),
            "multitask_strategy": multitask_strategy,
            "auth": _auth_to_request_payload(auth),
        }

        await asyncio.to_thread(
            repository.create_pending_run,
            run_id,
            thread_id=thread_id,
            assistant_id=assistant_id,
            request=request_payload,
            metadata=payload.get("metadata") or {},
            multitask_strategy=multitask_strategy,
        )

        headers = {
            "Content-Location": f"/threads/{thread_id}/runs/{run_id}",
            "Location": f"/threads/{thread_id}/runs/{run_id}/stream",
        }
        return (
            ActiveRun(
                run_id=run_id,
                thread_id=thread_id,
                assistant_id=assistant_id,
                requested_modes=requested_modes,
            ),
            headers,
        )

    async def run_and_wait(self, *, thread_id: str, payload: dict[str, Any], auth: Any) -> tuple[dict[str, Any], dict[str, str]]:
        active, headers = await self.start_run(thread_id=thread_id, payload=payload, auth=auth)
        run = await self._wait_for_run_terminal(active.run_id)
        if run.get("error") is not None:
            return {"__error__": run["error"]}, headers
        return (await self.get_state(thread_id)).get("values", {}), headers

    async def cancel_run(self, thread_id: str, run_id: str) -> dict[str, Any]:
        await self.ensure_ready()
        run = await asyncio.to_thread(repository.get_run, run_id)
        if run is None or run["thread_id"] != thread_id:
            raise KeyError(run_id)
        if run.get("status") in _TERMINAL_RUN_STATUSES:
            return run

        updated = await asyncio.to_thread(repository.mark_run_cancel_requested, run_id)
        if updated is None:
            raise KeyError(run_id)
        if updated.get("status") == "pending":
            error_payload = {"error": "RunInterrupted", "message": "Run cancelled"}
            await self._publish_event(
                ActiveRun(
                    run_id=run_id,
                    thread_id=thread_id,
                    assistant_id=run.get("assistant_id") or "lead_agent",
                    requested_modes=[],
                ),
                event_name="error",
                data=error_payload,
            )
            updated = await asyncio.to_thread(
                repository.update_run_status,
                run_id,
                status="interrupted",
                error=error_payload,
            ) or updated
            thread = await self.get_thread(thread_id)
            await self._persist_thread_values(
                thread_id=thread_id,
                auth=auth,
                status="idle",
                values=(thread or {}).get("values", {}),
                error=None,
                assistant_id=(thread or {}).get("assistant_id") or run.get("assistant_id") or "lead_agent",
            )
        return updated

    async def join_run(self, thread_id: str, run_id: str) -> dict[str, Any]:
        await self.ensure_ready()
        run = await asyncio.to_thread(repository.get_run, run_id)
        if run is None or run["thread_id"] != thread_id:
            raise KeyError(run_id)
        if run.get("status") not in _TERMINAL_RUN_STATUSES:
            run = await self._wait_for_run_terminal(run_id)
        if run.get("error") is not None:
            return {"__error__": run["error"]}
        return (await self.get_state(thread_id)).get("values", {})

    async def stream_run_events(
        self,
        *,
        run_id: str,
        after_event_id: str | None = None,
    ) -> AsyncGenerator[dict[str, Any], None]:
        await self.ensure_ready()
        last_event_id = after_event_id
        while True:
            events = await asyncio.to_thread(repository.list_run_events, run_id, after_event_id=last_event_id)
            if events:
                for event in events:
                    last_event_id = event["id"]
                    yield {"id": event["id"], "event": event["event"], "data": event["data"]}
                continue

            control = await asyncio.to_thread(repository.get_run_control, run_id)
            if control is None:
                return
            if control.get("status") in _TERMINAL_RUN_STATUSES:
                return
            await asyncio.sleep(0.2)

    async def _publish_event(
        self,
        active: ActiveRun,
        *,
        event_name: str,
        data: Any,
        namespace: list[str] | None = None,
    ) -> None:
        stored = await asyncio.to_thread(
            repository.append_run_event_auto,
            active.run_id,
            event_name=event_name,
            data=data,
            namespace=namespace,
        )
        logger.debug("Published run event: run=%s event=%s id=%s", active.run_id, stored["event"], stored["id"])

    async def execute_claimed_run(self, claimed_run: dict[str, Any]) -> None:
        await self.ensure_ready()
        request_payload = dict(claimed_run.get("request") or {})
        if not request_payload:
            request_payload = dict(await asyncio.to_thread(repository.get_run_request, claimed_run["run_id"]) or {})

        auth = _auth_from_request_payload(dict(request_payload.get("auth") or {}))
        active = ActiveRun(
            run_id=claimed_run["run_id"],
            thread_id=claimed_run["thread_id"],
            assistant_id=str(request_payload.get("assistant_id") or claimed_run.get("assistant_id") or "lead_agent"),
            requested_modes=_normalize_requested_modes(request_payload.get("stream_mode")),
        )
        await self._execute_run(active, request_payload, auth)

    async def _execute_run(self, active: ActiveRun, payload: dict[str, Any], auth: Any) -> None:
        context = dict(payload.get("context") or {})
        context.update(
            {
                "thread_id": active.thread_id,
                "user_id": auth.user_id,
                "email": auth.email,
                "is_admin": auth.is_admin,
            }
        )
        options = self._options_from_context(active.thread_id, context, auth)
        graph = self._agents.get(options, checkpointer=self._checkpointer)
        run_config = _build_runnable_config(options, payload.get("config"))
        input_payload = _normalize_message_inputs(payload.get("input") or {})
        graph_modes = ["values"]
        if "messages-tuple" in active.requested_modes or "messages" in active.requested_modes:
            graph_modes.append("messages")
        if "custom" in active.requested_modes:
            graph_modes.append("custom")

        previous_message_ids: set[str] = set()
        latest_state_snapshot: dict[str, Any] | None = None

        try:
            astream_kwargs: dict[str, Any] = {
                "config": run_config,
                "context": context,
                "stream_mode": graph_modes,
            }
            if payload.get("stream_subgraphs", False):
                astream_kwargs["subgraphs"] = True
            stream = graph.astream(input_payload, **astream_kwargs)

            async for item in stream:
                control = await asyncio.to_thread(repository.get_run_control, active.run_id)
                if control is not None and control.get("cancel_requested"):
                    raise RunInterrupted("Run cancelled")

                namespace: list[str] | None = None
                mode: str
                data: Any

                if isinstance(item, tuple):
                    if len(item) == 3:
                        raw_namespace, mode, data = item
                        namespace = list(raw_namespace) if isinstance(raw_namespace, tuple | list) else None
                    elif len(item) == 2:
                        mode, data = item
                    else:
                        mode, data = "values", item[-1]
                else:
                    mode, data = "values", item

                if mode == "custom":
                    await self._publish_event(active, event_name="custom", data=_normalize_payload(data), namespace=namespace)
                    continue

                if mode == "messages":
                    chunk_payload: Any
                    metadata_payload: Any = None
                    if isinstance(data, tuple | list) and len(data) == 2:
                        chunk_payload, metadata_payload = data
                    else:
                        chunk_payload = data
                    await self._publish_event(
                        active,
                        event_name="messages",
                        data=[
                            _normalize_stream_message(chunk_payload),
                            _normalize_payload(metadata_payload),
                        ],
                        namespace=namespace,
                    )
                    continue

                if mode != "values":
                    continue

                values_payload = _normalize_payload(data)
                if isinstance(values_payload, dict) and "values" in values_payload:
                    latest_state_snapshot = _coerce_state_snapshot(active.thread_id, values_payload)
                else:
                    latest_state_snapshot = _coerce_state_snapshot(active.thread_id, {"values": values_payload})
                latest_values = latest_state_snapshot["values"]

                if "values" in active.requested_modes:
                    await self._publish_event(active, event_name="values", data=latest_values, namespace=namespace)

                if "updates" in active.requested_modes:
                    await self._publish_event(active, event_name="updates", data={"lead_agent": latest_values}, namespace=namespace)

                if "events" in active.requested_modes:
                    messages = latest_values.get("messages") if isinstance(latest_values, dict) else None
                    if isinstance(messages, list):
                        for message in messages:
                            if not isinstance(message, dict) or message.get("type") != "tool":
                                continue
                            message_id = str(message.get("id") or f"{message.get('tool_call_id')}::{message.get('name')}")
                            if message_id in previous_message_ids:
                                continue
                            previous_message_ids.add(message_id)
                            await self._publish_event(
                                active,
                                event_name="events",
                                data={
                                    "event": "on_tool_end",
                                    "name": message.get("name"),
                                    "data": message.get("content"),
                                },
                                namespace=namespace,
                            )

            control = await asyncio.to_thread(repository.get_run_control, active.run_id)
            if control is not None and control.get("cancel_requested"):
                raise RunInterrupted("Run cancelled")
        except RunInterrupted:
            error_payload = {"error": "RunInterrupted", "message": "Run cancelled"}
            active.error_payload = error_payload
            values = (await self.get_state(active.thread_id)).get("values", {})
            try:
                values = (await self._snapshot_graph_state(graph, run_config, thread_id=active.thread_id)).get("values", values)
            except Exception:
                logger.exception("Failed to snapshot state for interrupted run: thread=%s run=%s", active.thread_id, active.run_id)
            await self._publish_event(active, event_name="error", data=error_payload)
            await asyncio.to_thread(repository.update_run_status, active.run_id, status="interrupted", error=error_payload)
            await self._persist_thread_values(
                thread_id=active.thread_id,
                auth=auth,
                status="idle",
                values=values,
                error=None,
                assistant_id=active.assistant_id,
            )
        except asyncio.CancelledError:
            error_payload = {"error": "RunInterrupted", "message": "Run cancelled"}
            active.error_payload = error_payload
            values = (await self.get_state(active.thread_id)).get("values", {})
            await self._publish_event(active, event_name="error", data=error_payload)
            await asyncio.to_thread(repository.update_run_status, active.run_id, status="interrupted", error=error_payload)
            await self._persist_thread_values(
                thread_id=active.thread_id,
                auth=auth,
                status="idle",
                values=values,
                error=None,
                assistant_id=active.assistant_id,
            )
            raise
        except Exception as exc:
            logger.exception("Monolith runtime run failed: thread=%s run=%s", active.thread_id, active.run_id)
            error_payload = {"error": exc.__class__.__name__, "message": str(exc)}
            active.error_payload = error_payload
            values = (await self.get_state(active.thread_id)).get("values", {})
            try:
                values = (await self._snapshot_graph_state(graph, run_config, thread_id=active.thread_id)).get("values", values)
            except Exception:
                logger.exception("Failed to snapshot state for failed run: thread=%s run=%s", active.thread_id, active.run_id)
            await self._publish_event(active, event_name="error", data=error_payload)
            await asyncio.to_thread(repository.update_run_status, active.run_id, status="error", error=error_payload)
            await self._persist_thread_values(
                thread_id=active.thread_id,
                auth=auth,
                status="error",
                values=values,
                error=error_payload,
                assistant_id=active.assistant_id,
            )
        else:
            try:
                latest_state_snapshot = await self._snapshot_graph_state(graph, run_config, thread_id=active.thread_id)
            except Exception:
                logger.exception("Failed to snapshot final graph state: thread=%s run=%s", active.thread_id, active.run_id)
                if latest_state_snapshot is None:
                    latest_state_snapshot = await self.get_state(active.thread_id)

            active.final_values = latest_state_snapshot["values"]
            checkpoint_id = str(latest_state_snapshot["checkpoint"].get("checkpoint_id") or uuid.uuid4())
            parent_checkpoint = latest_state_snapshot.get("parent_checkpoint")
            parent_checkpoint_id = parent_checkpoint.get("checkpoint_id") if isinstance(parent_checkpoint, dict) else None
            interrupted = bool(latest_state_snapshot["values"].get("__interrupt__"))

            await asyncio.to_thread(
                repository.save_thread_state,
                active.thread_id,
                checkpoint_id=checkpoint_id,
                parent_checkpoint_id=parent_checkpoint_id,
                values=latest_state_snapshot["values"],
                next_nodes=latest_state_snapshot.get("next", []),
                metadata=latest_state_snapshot.get("metadata"),
                tasks=latest_state_snapshot.get("tasks", []),
            )
            await self._persist_thread_values(
                thread_id=active.thread_id,
                auth=auth,
                assistant_id=active.assistant_id,
                status="interrupted" if interrupted else "idle",
                values=latest_state_snapshot["values"],
                error=None,
            )
            await asyncio.to_thread(
                repository.update_run_status,
                active.run_id,
                status="interrupted" if interrupted else "success",
                error=None,
            )


_runtime: MonolithRuntime | None = None


def get_monolith_runtime() -> MonolithRuntime:
    global _runtime
    if _runtime is None:
        _runtime = MonolithRuntime()
    return _runtime
