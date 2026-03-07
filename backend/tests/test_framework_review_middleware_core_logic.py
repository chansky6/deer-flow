"""Core behavior tests for FrameworkReviewMiddleware."""

from unittest.mock import MagicMock

from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END
from langgraph.types import Command

from src.agents.middlewares.framework_review_middleware import FrameworkReviewMiddleware


class TestFrameworkReviewMiddlewareCoreLogic:
    def test_wrap_tool_call_interrupts_and_stores_pending_review(self):
        middleware = FrameworkReviewMiddleware()
        request = MagicMock()
        request.tool_call = {
            "name": "request_framework_review",
            "id": "tc-review-1",
            "args": {
                "framework_markdown": "# Analysis Framework\n\n## Chapter 1",
                "review_title": "Review Analysis Framework",
                "instructions": "Edit the framework before continuing.",
            },
        }
        handler = MagicMock()

        result = middleware.wrap_tool_call(request, handler)

        assert isinstance(result, Command)
        assert result.goto == END
        assert result.update["framework_review"] == {
            "tool_call_id": "tc-review-1",
            "kind": "consulting_analysis",
            "status": "pending",
            "review_title": "Review Analysis Framework",
            "instructions": "Edit the framework before continuing.",
            "draft_markdown": "# Analysis Framework\n\n## Chapter 1",
        }
        assert len(result.update["messages"]) == 1
        assert result.update["messages"][0].name == "request_framework_review"
        assert result.update["messages"][0].content == "Framework review requested."
        handler.assert_not_called()

    def test_wrap_tool_call_returns_error_message_when_framework_is_missing(self):
        middleware = FrameworkReviewMiddleware()
        request = MagicMock()
        request.tool_call = {
            "name": "request_framework_review",
            "id": "tc-review-2",
            "args": {
                "framework_markdown": "   ",
                "review_title": "Review Analysis Framework",
            },
        }
        handler = MagicMock()

        result = middleware.wrap_tool_call(request, handler)

        assert isinstance(result, ToolMessage)
        assert result.name == "request_framework_review"
        assert result.status == "error"
        assert "framework_markdown" in result.content
        handler.assert_not_called()

    def test_wrap_model_call_injects_confirmed_framework_context(self):
        middleware = FrameworkReviewMiddleware()
        request = MagicMock()
        request.messages = [HumanMessage(content="继续下一步")]
        request.state = {
            "confirmed_analysis_framework": {
                "tool_call_id": "tc-review-3",
                "markdown": "# Confirmed Framework\n\n## Chapter 1",
            }
        }
        patched_request = MagicMock()
        request.override.return_value = patched_request
        handler = MagicMock(return_value="handled")

        result = middleware.wrap_model_call(request, handler)

        request.override.assert_called_once()
        patched_messages = request.override.call_args.kwargs["messages"]
        assert isinstance(patched_messages[0], SystemMessage)
        assert "<confirmed_analysis_framework>" in patched_messages[0].content
        assert "# Confirmed Framework" in patched_messages[0].content
        assert patched_messages[1].content == "继续下一步"
        handler.assert_called_once_with(patched_request)
        assert result == "handled"

    def test_wrap_model_call_skips_injection_without_confirmed_framework(self):
        middleware = FrameworkReviewMiddleware()
        request = MagicMock()
        request.messages = [HumanMessage(content="继续下一步")]
        request.state = {}
        handler = MagicMock(return_value="handled")

        result = middleware.wrap_model_call(request, handler)

        request.override.assert_not_called()
        handler.assert_called_once_with(request)
        assert result == "handled"
