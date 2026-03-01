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
