"""Middleware to drop invalid tool messages before model calls.

Some internal workflows inject ToolMessages that are not direct responses to a
preceding assistant tool_calls message (e.g., UI-only markers). OpenAI-compatible
APIs reject such sequences. This middleware filters out tool messages that do not
belong to the immediately preceding assistant tool_calls block.
"""

import logging
from collections.abc import Awaitable, Callable
from typing import override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelCallResult, ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, ToolMessage

logger = logging.getLogger(__name__)


class ToolMessageSanitizerMiddleware(AgentMiddleware[AgentState]):
    """Remove tool messages not associated with the latest assistant tool_calls."""

    def _filter_messages(self, messages: list) -> list | None:
        filtered: list = []
        allowed_tool_call_ids: set[str] | None = None
        seen_tool_call_ids: set[str] = set()
        dropped = 0

        for msg in messages:
            if isinstance(msg, AIMessage):
                filtered.append(msg)
                tool_calls = getattr(msg, "tool_calls", None) or []
                ids = [tc.get("id") for tc in tool_calls if tc.get("id")]
                if ids:
                    allowed_tool_call_ids = set(ids)
                    seen_tool_call_ids = set()
                else:
                    allowed_tool_call_ids = None
                    seen_tool_call_ids = set()
                continue

            if isinstance(msg, ToolMessage):
                tool_call_id = str(getattr(msg, "tool_call_id", "") or "")
                if allowed_tool_call_ids and tool_call_id in allowed_tool_call_ids and tool_call_id not in seen_tool_call_ids:
                    filtered.append(msg)
                    seen_tool_call_ids.add(tool_call_id)
                else:
                    dropped += 1
                continue

            # Any non-tool message breaks the tool-call response block.
            filtered.append(msg)
            allowed_tool_call_ids = None
            seen_tool_call_ids = set()

        if dropped:
            logger.warning("Dropped %d tool message(s) not tied to the latest assistant tool_calls.", dropped)
            return filtered
        return None

    @override
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelCallResult:
        patched = self._filter_messages(request.messages)
        if patched is not None:
            request = request.override(messages=patched)
        return handler(request)

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelCallResult:
        patched = self._filter_messages(request.messages)
        if patched is not None:
            request = request.override(messages=patched)
        return await handler(request)
