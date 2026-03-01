import logging
import os

from langchain.tools import BaseTool

logger = logging.getLogger(__name__)

DEEP_RESEARCH_TASK_TYPE = "deep_research"
DEEP_RESEARCH_TOOL_NAME = "deep_research"
DEEP_RESEARCH_MIN_FLOW_FLAG = "DEER_FLOW_ENABLE_DEEP_RESEARCH_MIN_FLOW"

# Minimal and stable tool surface for DeepResearch route.
ALLOWED_DEEP_RESEARCH_TOOL_NAMES = frozenset(
    {
        "web_search",
        "web_fetch",
        "ls",
        "read_file",
        "write_file",
        "str_replace",
        "present_files",
        "ask_clarification",
    }
)

DEEP_RESEARCH_MIN_FLOW_PROMPT = """
<deep_research_min_flow version="v1">
You are in a stable DeepResearch execution mode.

Follow this exact 4-stage workflow:
1) PLAN
- Restate scope, time range, and key questions.
- List evidence targets before searching.

2) RETRIEVE
- Use web_search/web_fetch for evidence collection.
- Prefer authoritative, recent, and directly relevant sources.
- Keep source diversity (official docs/data, academic/research, reputable industry/media).

3) SYNTHESIZE
- Group evidence by topic and identify agreements/conflicts.
- Distinguish facts, inferences, and uncertainties clearly.

4) REPORT
- Produce a structured markdown report using the exact sections below.

Hard gates before final answer (must pass both):
- Every key claim must include an inline citation in format: [citation:TITLE](URL).
- References must contain at least 2 distinct source categories.

If any gate fails, continue retrieval and synthesis; do not finalize early.

Output format (exact section order):
## Scope
## Method
## Findings
## Risks and Uncertainties
## References

Reference line format:
- [citation:TITLE](URL) | category: official|academic|industry|media|other
</deep_research_min_flow>
""".strip()


def is_deep_research_route(task_type: str | None, tool_name: str | None) -> bool:
    """Return whether this run should use the DeepResearch route."""
    return task_type == DEEP_RESEARCH_TASK_TYPE or tool_name == DEEP_RESEARCH_TOOL_NAME


def is_deep_research_min_flow_enabled() -> bool:
    """Feature flag for quick rollback.

    Set `DEER_FLOW_ENABLE_DEEP_RESEARCH_MIN_FLOW=false` to disable and fall back
    to the legacy route.
    """
    raw = os.getenv(DEEP_RESEARCH_MIN_FLOW_FLAG)
    if raw is None:
        return True

    normalized = raw.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False

    logger.warning(
        "Invalid %s value %r; fallback to enabled=true",
        DEEP_RESEARCH_MIN_FLOW_FLAG,
        raw,
    )
    return True


def filter_deep_research_tools(tools: list[BaseTool]) -> list[BaseTool]:
    """Restrict tools to a stable minimal set for DeepResearch."""
    filtered = [tool for tool in tools if tool.name in ALLOWED_DEEP_RESEARCH_TOOL_NAMES]
    if not filtered:
        logger.warning("DeepResearch tool filtering produced an empty set; using original tool list.")
        return tools

    logger.info("DeepResearch minimal toolset enabled: %s", [tool.name for tool in filtered])
    return filtered


def build_deep_research_system_prompt(base_prompt: str) -> str:
    """Append DeepResearch minimal-flow constraints to the base system prompt."""
    return f"{base_prompt}\n\n{DEEP_RESEARCH_MIN_FLOW_PROMPT}"

