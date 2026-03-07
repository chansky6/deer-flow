"""Middleware for structured analysis framework review interrupts."""

from collections.abc import Awaitable, Callable
from typing import NotRequired, override

from langchain.agents import AgentState
from langchain.agents.middleware import AgentMiddleware
from langchain.agents.middleware.types import ModelCallResult, ModelRequest, ModelResponse
from langchain_core.messages import SystemMessage, ToolMessage
from langgraph.graph import END
from langgraph.prebuilt.tool_node import ToolCallRequest
from langgraph.types import Command

from src.agents.thread_state import ConfirmedAnalysisFrameworkState, FrameworkReviewState


class FrameworkReviewMiddlewareState(AgentState):
    """Compatible with the `ThreadState` schema."""

    framework_review: NotRequired[FrameworkReviewState | None]
    confirmed_analysis_framework: NotRequired[ConfirmedAnalysisFrameworkState | None]


class FrameworkReviewMiddleware(AgentMiddleware[FrameworkReviewMiddlewareState]):
    """Handles structured framework review interrupts and confirmed framework context injection."""

    state_schema = FrameworkReviewMiddlewareState
    _DEFAULT_INSTRUCTIONS = "Review and edit the draft analysis framework below, then confirm to continue."

    def _build_review_state(self, args: dict, tool_call_id: str) -> FrameworkReviewState:
        instructions = str(args.get("instructions") or "").strip() or self._DEFAULT_INSTRUCTIONS
        return {
            "tool_call_id": tool_call_id,
            "kind": "consulting_analysis",
            "status": "pending",
            "review_title": str(args.get("review_title") or "Review Analysis Framework").strip() or "Review Analysis Framework",
            "instructions": instructions,
            "draft_markdown": str(args.get("framework_markdown") or "").strip(),
        }

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
        framework_markdown = str(args.get("framework_markdown") or "").strip()

        if not framework_markdown:
            return ToolMessage(
                content="Error: request_framework_review requires a non-empty framework_markdown.",
                tool_call_id=tool_call_id,
                name="request_framework_review",
                status="error",
            )

        review_state = self._build_review_state(args, tool_call_id)
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
