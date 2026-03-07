from langchain.tools import tool
from langgraph.config import get_stream_writer

_DEFAULT_REVIEW_TITLE = "Review Analysis Framework"
_DEFAULT_INSTRUCTIONS = "Review and edit the draft analysis framework below, then confirm to continue."


@tool("start_framework_review_draft", parse_docstring=True)
def start_framework_review_draft_tool(
    review_title: str,
    instructions: str | None = None,
) -> str:
    """Start streaming an analysis framework draft into the inline review UI.

    Use this tool immediately before outputting the framework markdown itself.
    This does not pause the workflow. It only tells the frontend to open the
    framework-review card and mirror the next assistant markdown response there.

    Required workflow:
    - Call this tool first
    - Then output the COMPLETE framework markdown as a normal assistant response
    - Then call `request_framework_review` to open the review UI
    - Do not add extra narrative before or after the framework markdown

    Args:
        review_title: Short title displayed in the framework review UI.
        instructions: Optional guidance shown above the draft while it streams.
    """
    normalized_review_title = str(review_title).strip() or _DEFAULT_REVIEW_TITLE
    normalized_instructions = str(instructions or "").strip() or _DEFAULT_INSTRUCTIONS

    writer = get_stream_writer()
    writer(
        {
            "type": "framework_review_draft_started",
            "kind": "consulting_analysis",
            "review_title": normalized_review_title,
            "instructions": normalized_instructions,
        }
    )

    return "Framework review draft started. Output the framework markdown next."


@tool("request_framework_review", parse_docstring=True, return_direct=True)
def request_framework_review_tool(
    review_title: str,
    instructions: str | None = None,
    framework_markdown: str | None = None,
) -> str:
    """Request the user to review and edit an analysis framework before continuing.

    Use this tool when you have finished drafting a complete analysis framework,
    already streamed that draft to the user in the same assistant response, and now
    need confirmation before the workflow proceeds.

    When to use request_framework_review:
    - You generated a complete Phase 1 analysis framework for the consulting-analysis skill
    - The next workflow stage depends on the framework being confirmed by the user
    - You want the frontend to present the framework in a dedicated editable review card

    Best practices:
    - First call `start_framework_review_draft`
    - Then output the COMPLETE framework markdown as a normal assistant response
    - Call this tool in the same assistant response that contains that final markdown
    - Prefer omitting `framework_markdown`; the backend will capture the assistant markdown automatically
    - If you provide `framework_markdown` for compatibility, keep it identical to the streamed draft the user just saw
    - Use a concise `review_title` suitable for the review card header
    - Use `instructions` to explain what the user should do next
    - Call this tool immediately after the streamed framework draft is complete

    Args:
        review_title: Short title displayed in the framework review UI.
        instructions: Optional guidance shown above the editable framework.
        framework_markdown: Deprecated optional copy of the full framework draft in Markdown format.
    """
    return "Framework review request processed by middleware"
