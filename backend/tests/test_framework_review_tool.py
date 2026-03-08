"""Tests for framework review tools."""

from unittest.mock import patch

from src.tools.builtins.framework_review_tool import request_framework_review_tool, start_framework_review_draft_tool


class TestFrameworkReviewTools:
    @patch("src.tools.builtins.framework_review_tool.get_stream_writer")
    def test_start_framework_review_draft_emits_custom_event(self, mock_get_stream_writer):
        mock_writer = mock_get_stream_writer.return_value

        result = start_framework_review_draft_tool.func(
            review_title="Review Analysis Framework",
            instructions="Review the streaming draft before continuing.",
        )

        mock_get_stream_writer.assert_called_once_with()
        mock_writer.assert_called_once_with(
            {
                "type": "framework_review_draft_started",
                "kind": "consulting_analysis",
                "review_title": "Review Analysis Framework",
                "instructions": "Review the streaming draft before continuing.",
            }
        )
        assert result == "Framework review draft started. Output the framework markdown next so the backend can open review automatically."

    @patch("src.tools.builtins.framework_review_tool.get_stream_writer")
    def test_start_framework_review_draft_uses_defaults_for_blank_values(self, mock_get_stream_writer):
        mock_writer = mock_get_stream_writer.return_value

        start_framework_review_draft_tool.func(review_title="  ", instructions="   ")

        mock_writer.assert_called_once_with(
            {
                "type": "framework_review_draft_started",
                "kind": "consulting_analysis",
                "review_title": "Review Analysis Framework",
                "instructions": "Review and edit the draft analysis framework below, then confirm to continue.",
            }
        )

    def test_request_framework_review_accepts_metadata_without_markdown_copy(self):
        result = request_framework_review_tool.func(
            review_title="Review Analysis Framework",
            instructions="Please confirm before I continue.",
        )

        assert result == "Framework review request processed by middleware"
