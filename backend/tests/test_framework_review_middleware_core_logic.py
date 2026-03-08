"""Core behavior tests for FrameworkReviewMiddleware."""

import logging
from unittest.mock import MagicMock

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END
from langgraph.types import Command

from src.agents.middlewares.framework_review_middleware import FrameworkReviewMiddleware


class TestFrameworkReviewMiddlewareCoreLogic:
    def test_wrap_tool_call_interrupts_and_stores_pending_review_from_assistant_message(self):
        middleware = FrameworkReviewMiddleware()
        request = MagicMock()
        request.tool_call = {
            "name": "request_framework_review",
            "id": "tc-review-1",
            "args": {
                "review_title": "Review Analysis Framework",
                "instructions": "Edit the framework before continuing.",
            },
        }
        request.state = {
            "messages": [
                AIMessage(
                    content="# Analysis Framework\n\n## Chapter 1",
                    tool_calls=[
                        {
                            "name": "request_framework_review",
                            "id": "tc-review-1",
                            "args": {
                                "review_title": "Review Analysis Framework",
                                "instructions": "Edit the framework before continuing.",
                            },
                        }
                    ],
                )
            ]
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

    def test_wrap_tool_call_falls_back_to_tool_argument_markdown(self):
        middleware = FrameworkReviewMiddleware()
        request = MagicMock()
        request.tool_call = {
            "name": "request_framework_review",
            "id": "tc-review-fallback",
            "args": {
                "framework_markdown": "# Fallback Framework\n\n## Chapter 1",
                "review_title": "Review Analysis Framework",
            },
        }
        request.state = {"messages": []}
        handler = MagicMock()

        result = middleware.wrap_tool_call(request, handler)

        assert isinstance(result, Command)
        assert result.update["framework_review"]["draft_markdown"] == "# Fallback Framework\n\n## Chapter 1"
        handler.assert_not_called()

    def test_wrap_tool_call_prefers_assistant_content_over_tool_argument(self, caplog):
        middleware = FrameworkReviewMiddleware()
        request = MagicMock()
        request.tool_call = {
            "name": "request_framework_review",
            "id": "tc-review-override",
            "args": {
                "framework_markdown": "# Old Framework\n\n## Wrong",
                "review_title": "Review Analysis Framework",
            },
        }
        request.state = {
            "messages": [
                AIMessage(
                    content="# New Framework\n\n## Right",
                    tool_calls=[
                        {
                            "name": "request_framework_review",
                            "id": "tc-review-override",
                            "args": {
                                "review_title": "Review Analysis Framework",
                            },
                        }
                    ],
                )
            ]
        }
        handler = MagicMock()

        caplog.set_level(logging.WARNING)

        result = middleware.wrap_tool_call(request, handler)

        assert isinstance(result, Command)
        assert result.update["framework_review"]["draft_markdown"] == "# New Framework\n\n## Right"
        assert "mismatched assistant content" in caplog.text
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
        request.state = {"messages": []}
        handler = MagicMock()

        result = middleware.wrap_tool_call(request, handler)

        assert isinstance(result, ToolMessage)
        assert result.name == "request_framework_review"
        assert result.status == "error"
        assert "assistant message" in result.content
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


    def test_after_model_auto_interrupts_after_streamed_framework_draft(self):
        middleware = FrameworkReviewMiddleware()
        state = {
            "messages": [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "start_framework_review_draft",
                            "id": "tc-start-1",
                            "args": {
                                "review_title": "Review Analysis Framework",
                                "instructions": "Please edit before I continue.",
                            },
                        }
                    ],
                ),
                ToolMessage(
                    content="Framework review draft started. Output the framework markdown next.",
                    tool_call_id="tc-start-1",
                    name="start_framework_review_draft",
                ),
                AIMessage(content="# Analysis Framework\n\n## Chapter 1"),
            ]
        }

        result = middleware.after_model(state, MagicMock())

        assert result is not None
        assert result["jump_to"] == "end"
        assert result["framework_review"] == {
            "tool_call_id": "tc-start-1",
            "kind": "consulting_analysis",
            "status": "pending",
            "review_title": "Review Analysis Framework",
            "instructions": "Please edit before I continue.",
            "draft_markdown": "# Analysis Framework\n\n## Chapter 1",
        }
        assert len(result["messages"]) == 1
        assert isinstance(result["messages"][0], ToolMessage)
        assert result["messages"][0].name == "request_framework_review"
        assert result["messages"][0].tool_call_id == "tc-start-1"
        assert result["messages"][0].content == "Framework review requested."

    def test_after_model_auto_interrupts_when_framework_draft_and_tool_calls_share_ai_message(self):
        middleware = FrameworkReviewMiddleware()
        state = {
            "messages": [
                AIMessage(
                    content="",
                    tool_calls=[
                        {
                            "name": "start_framework_review_draft",
                            "id": "tc-start-2",
                            "args": {
                                "review_title": "Review Analysis Framework",
                                "instructions": "Please edit before I continue.",
                            },
                        }
                    ],
                ),
                ToolMessage(
                    content="Framework review draft started. Output the framework markdown next.",
                    tool_call_id="tc-start-2",
                    name="start_framework_review_draft",
                ),
                AIMessage(
                    content="# Analysis Framework\n\n## Chapter 1",
                    tool_calls=[
                        {
                            "name": "web_search",
                            "id": "tc-search-1",
                            "args": {"query": "should not run"},
                        }
                    ],
                ),
            ]
        }

        result = middleware.after_model(state, MagicMock())

        assert result is not None
        assert result["jump_to"] == "end"
        assert result["framework_review"] == {
            "tool_call_id": "tc-start-2",
            "kind": "consulting_analysis",
            "status": "pending",
            "review_title": "Review Analysis Framework",
            "instructions": "Please edit before I continue.",
            "draft_markdown": "# Analysis Framework\n\n## Chapter 1",
        }
        assert len(result["messages"]) == 1
        assert isinstance(result["messages"][0], ToolMessage)
        assert result["messages"][0].name == "request_framework_review"
        assert result["messages"][0].tool_call_id == "tc-start-2"

    def test_after_model_skips_auto_interrupt_when_latest_ai_message_has_tool_calls_without_start_marker(self):
        middleware = FrameworkReviewMiddleware()
        state = {
            "messages": [
                AIMessage(
                    content="# Analysis Framework",
                    tool_calls=[
                        {
                            "name": "request_framework_review",
                            "id": "tc-review-1",
                            "args": {},
                        }
                    ],
                )
            ]
        }

        result = middleware.after_model(state, MagicMock())

        assert result is None

    def test_after_model_skips_auto_interrupt_without_start_marker(self):
        middleware = FrameworkReviewMiddleware()
        state = {
            "messages": [
                AIMessage(content="# Analysis Framework\n\n## Chapter 1"),
            ]
        }

        result = middleware.after_model(state, MagicMock())

        assert result is None

    def test_after_model_skips_auto_interrupt_when_review_or_confirmation_already_exists(self):
        middleware = FrameworkReviewMiddleware()
        state_with_pending_review = {
            "framework_review": {"status": "pending"},
            "messages": [AIMessage(content="# Analysis Framework")],
        }
        state_with_confirmed_framework = {
            "confirmed_analysis_framework": {"tool_call_id": "tc", "markdown": "# Confirmed"},
            "messages": [AIMessage(content="# Analysis Framework")],
        }

        assert middleware.after_model(state_with_pending_review, MagicMock()) is None
        assert middleware.after_model(state_with_confirmed_framework, MagicMock()) is None
