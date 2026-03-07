"""Middleware for structured analysis framework review interrupts."""

import logging

from collections.abc import Awaitable, Callable
from typing import Any, NotRequired, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelCallResult, ModelRequest, ModelResponse
from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langgraph.graph import END
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command

from src.agents.thread_state import ConfirmedAnalysisFrameworkState, FrameworkReviewState


logger = logging.getLogger(__name__)


class FrameworkReviewMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    framework_review: NotRequired[FrameworkReviewState | None]
    confirmed_analysis_framework: NotRequired[ConfirmedAnalysisFrameworkState | None]


class FrameworkReviewMiddleware(AgentMiddleware[FrameworkReviewMiddlewareState]):
    """Handles structured framework review interrupts and confirmed framework context injection."""

    state_schema = FrameworkReviewMiddlewareState
    _DEFAULT_INSTRUCTIONS = "Review and edit the draft analysis framework below, then confirm to continue."

    def _build_review_state(self, args: dict, tool_call_id: str, framework_markdown: str) -> FrameworkReviewState:
        instructions = str(args.get("instructions") or "").strip() or self._DEFAULT_INSTRUCTIONS
        return {
            "tool_call_id": tool_call_id,
            "kind": "consulting_analysis",
            "status": "pending",
            "review_title": str(args.get("review_title") or "Review Analysis Framework").strip() or "Review Analysis Framework",
            "instructions": instructions,
            "draft_markdown": framework_markdown,
        }

    def _extract_text_content(self, content: Any) -> str:
        if isinstance(content, str):
            return content.strip()
        if isinstance(content, list):
            parts: list[str] = []
            for block in content:
                if isinstance(block, str):
                    parts.append(block)
                elif isinstance(block, dict) and block.get("type") == "text":
                    parts.append(str(block.get("text") or ""))
            return "\n".join(parts).strip()
        if content is None:
            return ""
        return str(content).strip()

    def _get_state_messages(self, state: Any) -> list:
        if hasattr(state, "get"):
            messages = state.get("messages", [])
            if isinstance(messages, list):
                return messages
        messages = getattr(state, "messages", [])
        return messages if isinstance(messages, list) else []

    def _find_requesting_ai_message(self, messages: list, tool_call_id: str) -> AIMessage | None:
        for message in reversed(messages):
            if not isinstance(message, AIMessage) or not message.tool_calls:
                continue
            if any(tool_call.get("id") == tool_call_id for tool_call in message.tool_calls):
                return message
        return None

    def _resolve_framework_markdown(self, request: ToolCallRequest) -> str:
        args = request.tool_call.get("args", {})
        tool_call_id = str(request.tool_call.get("id") or "")
        fallback_markdown = str(args.get("framework_markdown") or "").strip()

        messages = self._get_state_messages(request.state)
        assistant_message = self._find_requesting_ai_message(messages, tool_call_id)
        assistant_markdown = self._extract_text_content(assistant_message.content) if assistant_message else ""

        if assistant_markdown and fallback_markdown and assistant_markdown != fallback_markdown:
            logger.warning(
                "Framework review tool arg markdown mismatched assistant content; using assistant content",
                extra={"tool_call_id": tool_call_id},
            )

        return assistant_markdown or fallback_markdown

    def _build_review_tool_message(self, tool_call_id: str) -> ToolMessage:
        return ToolMessage(
            content="Framework review requested.",
            tool_call_id=tool_call_id,
            name="request_framework_review",
        )

    def _build_confirmed_framework_system_message(self, markdown: str) -> SystemMessage:
        return SystemMessage(
            content=(
                "<confirmed_analysis_framework>\n"
                f"{markdown}\n"
                "</confirmed_analysis_framework>\n\n"
                "Treat this as the authoritative analysis framework for the current consulting-analysis workflow."
            )
        )

    def _handle_framework_review(self, request: ToolCallRequest) -> ToolMessage | Command:
        args = request.tool_call.get("args", {})
        tool_call_id = str(request.tool_call.get("id") or "")
        framework_markdown = self._resolve_framework_markdown(request)

        if not framework_markdown:
            return ToolMessage(
                content="Error: request_framework_review requires framework content in the assistant message or framework_markdown.",
                tool_call_id=tool_call_id,
                name="request_framework_review",
                status="error",
            )

        review_state = self._build_review_state(args, tool_call_id, framework_markdown)
        tool_message = self._build_review_tool_message(tool_call_id)

        return Command(
            update={
                "framework_review": review_state,
                "messages": [tool_message],
            },
            goto=END,
        )

    def _patch_messages_with_confirmed_framework(self, messages: list, markdown: str) -> list:
        return [self._build_confirmed_framework_system_message(markdown), *messages]

    @override
    def wrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        if request.tool_call.get("name") != "request_framework_review":
            return handler(request)

        return self._handle_framework_review(request)

    @override
    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], ToolMessage | Command],
    ) -> ToolMessage | Command:
        if request.tool_call.get("name") != "request_framework_review":
            return await handler(request)

        return self._handle_framework_review(request)

    @override
    def wrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelCallResult:
        confirmed_framework = (request.state or {}).get("confirmed_analysis_framework")
        markdown = str((confirmed_framework or {}).get("markdown") or "").strip()
        if not markdown:
            return handler(request)

        patched_messages = self._patch_messages_with_confirmed_framework(request.messages, markdown)
        return handler(request.override(messages=patched_messages))

    @override
    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ) -> ModelCallResult:
        confirmed_framework = (request.state or {}).get("confirmed_analysis_framework")
        markdown = str((confirmed_framework or {}).get("markdown") or "").strip()
        if not markdown:
            return await handler(request)

        patched_messages = self._patch_messages_with_confirmed_framework(request.messages, markdown)
        return await handler(request.override(messages=patched_messages))
