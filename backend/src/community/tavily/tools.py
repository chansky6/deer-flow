import json
import logging
import time

from langchain.tools import tool
from requests.exceptions import ConnectionError, Timeout
from tavily import TavilyClient

from src.config import get_app_config

logger = logging.getLogger(__name__)

DEFAULT_TIMEOUT = 90
MAX_RETRIES = 3
RETRY_BACKOFF = 2


def _get_tavily_config():
    """Get tavily tool config with defaults."""
    config = get_app_config().get_tool_config("web_search")
    result = {"api_key": None, "api_base_url": None, "max_results": 5, "timeout": DEFAULT_TIMEOUT, "max_retries": MAX_RETRIES}
    if config is not None:
        if "api_key" in config.model_extra:
            result["api_key"] = config.model_extra.get("api_key")
        if "api_url" in config.model_extra:
            result["api_base_url"] = config.model_extra.get("api_url")
        if "max_results" in config.model_extra:
            result["max_results"] = config.model_extra.get("max_results")
        if "timeout" in config.model_extra:
            result["timeout"] = config.model_extra.get("timeout")
        if "max_retries" in config.model_extra:
            result["max_retries"] = config.model_extra.get("max_retries")
    return result


def _get_tavily_client() -> TavilyClient:
    cfg = _get_tavily_config()
    kwargs = {"api_key": cfg["api_key"]}
    if cfg["api_base_url"]:
        kwargs["api_base_url"] = cfg["api_base_url"]
    return TavilyClient(**kwargs)


def _retry_call(fn, max_retries: int, description: str):
    """Execute fn with retry on timeout/connection errors."""
    for attempt in range(1, max_retries + 1):
        try:
            return fn()
        except (ConnectionError, Timeout) as e:
            if attempt == max_retries:
                logger.error("Tavily %s failed after %d attempts: %s", description, max_retries, e)
                raise
            wait = RETRY_BACKOFF * attempt
            logger.warning("Tavily %s attempt %d/%d failed (%s), retrying in %ds...", description, attempt, max_retries, type(e).__name__, wait)
            time.sleep(wait)


@tool("web_search", parse_docstring=True)
def web_search_tool(query: str) -> str:
    """Search the web.

    Args:
        query: The query to search for.
    """
    cfg = _get_tavily_config()
    client = _get_tavily_client()
    res = _retry_call(
        lambda: client.search(query, max_results=cfg["max_results"], timeout=cfg["timeout"]),
        max_retries=cfg["max_retries"],
        description=f"search '{query}'",
    )
    normalized_results = [
        {
            "title": result["title"],
            "url": result["url"],
            "snippet": result["content"],
        }
        for result in res["results"]
    ]
    json_results = json.dumps(normalized_results, indent=2, ensure_ascii=False)
    return json_results


@tool("web_fetch", parse_docstring=True)
def web_fetch_tool(url: str) -> str:
    """Fetch the contents of a web page at a given URL.
    Only fetch EXACT URLs that have been provided directly by the user or have been returned in results from the web_search and web_fetch tools.
    This tool can NOT access content that requires authentication, such as private Google Docs or pages behind login walls.
    Do NOT add www. to URLs that do NOT have them.
    URLs must include the schema: https://example.com is a valid URL while example.com is an invalid URL.

    Args:
        url: The URL to fetch the contents of.
    """
    client = _get_tavily_client()
    cfg = _get_tavily_config()
    res = _retry_call(
        lambda: client.extract([url]),
        max_retries=cfg["max_retries"],
        description=f"fetch '{url}'",
    )
    if "failed_results" in res and len(res["failed_results"]) > 0:
        return f"Error: {res['failed_results'][0]['error']}"
    elif "results" in res and len(res["results"]) > 0:
        result = res["results"][0]
        return f"# {result['title']}\n\n{result['raw_content'][:4096]}"
    else:
        return "Error: No results found"
