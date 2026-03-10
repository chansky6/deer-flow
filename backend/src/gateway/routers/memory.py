"""Memory API router for retrieving and managing per-user memory data."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from src.agents.memory.updater import get_memory_data, reload_memory_data
from src.config.memory_config import get_memory_config
from src.config.paths import get_paths
from src.gateway.auth import AuthContext, require_auth

router = APIRouter(prefix="/api", tags=["memory"])


class ContextSection(BaseModel):
    """Model for context sections (user and history)."""

    summary: str = Field(default="", description="Summary content")
    updatedAt: str = Field(default="", description="Last update timestamp")


class UserContext(BaseModel):
    """Model for user context."""

    workContext: ContextSection = Field(default_factory=ContextSection)
    personalContext: ContextSection = Field(default_factory=ContextSection)
    topOfMind: ContextSection = Field(default_factory=ContextSection)


class HistoryContext(BaseModel):
    """Model for history context."""

    recentMonths: ContextSection = Field(default_factory=ContextSection)
    earlierContext: ContextSection = Field(default_factory=ContextSection)
    longTermBackground: ContextSection = Field(default_factory=ContextSection)


class Fact(BaseModel):
    """Model for a memory fact."""

    id: str = Field(..., description="Unique identifier for the fact")
    content: str = Field(..., description="Fact content")
    category: str = Field(default="context", description="Fact category")
    confidence: float = Field(default=0.5, description="Confidence score (0-1)")
    createdAt: str = Field(default="", description="Creation timestamp")
    source: str = Field(default="unknown", description="Source thread ID")


class MemoryResponse(BaseModel):
    """Response model for memory data."""

    version: str = Field(default="1.0", description="Memory schema version")
    lastUpdated: str = Field(default="", description="Last update timestamp")
    user: UserContext = Field(default_factory=UserContext)
    history: HistoryContext = Field(default_factory=HistoryContext)
    facts: list[Fact] = Field(default_factory=list)


class MemoryConfigResponse(BaseModel):
    """Response model for memory configuration."""

    enabled: bool = Field(..., description="Whether memory is enabled")
    storage_path: str = Field(..., description="Path to memory storage file")
    debounce_seconds: int = Field(..., description="Debounce time for memory updates")
    max_facts: int = Field(..., description="Maximum number of facts to store")
    fact_confidence_threshold: float = Field(..., description="Minimum confidence threshold for facts")
    injection_enabled: bool = Field(..., description="Whether memory injection is enabled")
    max_injection_tokens: int = Field(..., description="Maximum tokens for memory injection")


class MemoryStatusResponse(BaseModel):
    """Response model for memory status."""

    config: MemoryConfigResponse
    data: MemoryResponse


def _build_memory_config_response(user_id: str) -> MemoryConfigResponse:
    config = get_memory_config()
    return MemoryConfigResponse(
        enabled=config.enabled,
        storage_path=str(get_paths().user_memory_file(user_id)),
        debounce_seconds=config.debounce_seconds,
        max_facts=config.max_facts,
        fact_confidence_threshold=config.fact_confidence_threshold,
        injection_enabled=config.injection_enabled,
        max_injection_tokens=config.max_injection_tokens,
    )


@router.get(
    "/memory",
    response_model=MemoryResponse,
    summary="Get Memory Data",
    description="Retrieve the authenticated user's memory data including user context, history, and facts.",
)
async def get_memory(auth: AuthContext = Depends(require_auth)) -> MemoryResponse:
    memory_data = get_memory_data(user_id=auth.user_id)
    return MemoryResponse(**memory_data)


@router.post(
    "/memory/reload",
    response_model=MemoryResponse,
    summary="Reload Memory Data",
    description="Reload the authenticated user's memory data from storage, refreshing the in-memory cache.",
)
async def reload_memory(auth: AuthContext = Depends(require_auth)) -> MemoryResponse:
    memory_data = reload_memory_data(user_id=auth.user_id)
    return MemoryResponse(**memory_data)


@router.get(
    "/memory/config",
    response_model=MemoryConfigResponse,
    summary="Get Memory Configuration",
    description="Retrieve the current memory system configuration for the authenticated user.",
)
async def get_memory_config_endpoint(auth: AuthContext = Depends(require_auth)) -> MemoryConfigResponse:
    return _build_memory_config_response(auth.user_id)


@router.get(
    "/memory/status",
    response_model=MemoryStatusResponse,
    summary="Get Memory Status",
    description="Retrieve both memory configuration and current authenticated-user data in a single request.",
)
async def get_memory_status(auth: AuthContext = Depends(require_auth)) -> MemoryStatusResponse:
    memory_data = get_memory_data(user_id=auth.user_id)
    return MemoryStatusResponse(config=_build_memory_config_response(auth.user_id), data=MemoryResponse(**memory_data))
