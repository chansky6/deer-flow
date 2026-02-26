"""Config management router for the admin panel.

Provides GET/PUT endpoints for each config.yaml section.
Reads raw YAML (preserving $ENV_VAR references) and writes back with reload.
"""

import logging
from typing import Any

import yaml
from fastapi import APIRouter

from src.config.app_config import AppConfig, reload_app_config

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/config", tags=["config"])


def _read_raw_config() -> dict[str, Any]:
    """Read the raw YAML config without resolving env variables."""
    path = AppConfig.resolve_config_path()
    with open(path) as f:
        data = yaml.safe_load(f)
    return data or {}


def _write_and_reload(section: str, value: Any) -> dict[str, str]:
    """Write a section back to config.yaml and reload the app config.

    Uses truncate-and-rewrite (preserving inode) so Docker single-file
    bind mounts see the updated content on all platforms.
    """
    path = AppConfig.resolve_config_path()
    data = _read_raw_config()
    data[section] = value
    content = yaml.dump(data, default_flow_style=False, sort_keys=False, allow_unicode=True)
    # Open with r+b to preserve the inode (critical for Docker bind mounts)
    with open(path, "r+b") as f:
        encoded = content.encode("utf-8")
        f.write(encoded)
        f.truncate()
    reload_app_config()
    logger.info(f"Config section '{section}' updated and reloaded")
    return {"status": "ok"}


# --- Models ---


@router.get("/models", summary="Get models config")
async def get_models_config() -> list[dict]:
    """Return the raw models list from config.yaml."""
    return _read_raw_config().get("models", [])


@router.put("/models", summary="Update models config")
async def put_models_config(payload: list[dict]) -> dict:
    """Replace the models list in config.yaml."""
    return _write_and_reload("models", payload)


# --- Tools ---


@router.get("/tools", summary="Get tools config")
async def get_tools_config() -> list[dict]:
    """Return the raw tools list from config.yaml."""
    return _read_raw_config().get("tools", [])


@router.put("/tools", summary="Update tools config")
async def put_tools_config(payload: list[dict]) -> dict:
    """Replace the tools list in config.yaml."""
    return _write_and_reload("tools", payload)


# --- Tool Groups ---


@router.get("/tool-groups", summary="Get tool groups config")
async def get_tool_groups_config() -> list[dict]:
    """Return the raw tool_groups list from config.yaml."""
    return _read_raw_config().get("tool_groups", [])


@router.put("/tool-groups", summary="Update tool groups config")
async def put_tool_groups_config(payload: list[dict]) -> dict:
    """Replace the tool_groups list in config.yaml."""
    return _write_and_reload("tool_groups", payload)


# --- Sandbox ---


@router.get("/sandbox", summary="Get sandbox config")
async def get_sandbox_config() -> dict:
    """Return the raw sandbox config from config.yaml."""
    return _read_raw_config().get("sandbox", {})


@router.put("/sandbox", summary="Update sandbox config")
async def put_sandbox_config(payload: dict) -> dict:
    """Replace the sandbox config in config.yaml."""
    return _write_and_reload("sandbox", payload)


# --- Memory ---


@router.get("/memory", summary="Get memory config")
async def get_memory_config() -> dict:
    """Return the raw memory config from config.yaml."""
    return _read_raw_config().get("memory", {})


@router.put("/memory", summary="Update memory config")
async def put_memory_config(payload: dict) -> dict:
    """Replace the memory config in config.yaml."""
    return _write_and_reload("memory", payload)


# --- Title ---


@router.get("/title", summary="Get title config")
async def get_title_config() -> dict:
    """Return the raw title generation config from config.yaml."""
    return _read_raw_config().get("title", {})


@router.put("/title", summary="Update title config")
async def put_title_config(payload: dict) -> dict:
    """Replace the title generation config in config.yaml."""
    return _write_and_reload("title", payload)


# --- Summarization ---


@router.get("/summarization", summary="Get summarization config")
async def get_summarization_config() -> dict:
    """Return the raw summarization config from config.yaml."""
    return _read_raw_config().get("summarization", {})


@router.put("/summarization", summary="Update summarization config")
async def put_summarization_config(payload: dict) -> dict:
    """Replace the summarization config in config.yaml."""
    return _write_and_reload("summarization", payload)


# --- Subagents ---


@router.get("/subagents", summary="Get subagents config")
async def get_subagents_config() -> dict:
    """Return the raw subagents config from config.yaml."""
    return _read_raw_config().get("subagents", {})


@router.put("/subagents", summary="Update subagents config")
async def put_subagents_config(payload: dict) -> dict:
    """Replace the subagents config in config.yaml."""
    return _write_and_reload("subagents", payload)
