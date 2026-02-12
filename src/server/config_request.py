# Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
# SPDX-License-Identifier: MIT

from pydantic import BaseModel, Field

from src.server.rag_request import RAGConfigResponse


class AuthConfigResponse(BaseModel):
    """Response model for auth config."""

    enabled: bool = Field(False, description="Whether authentication is enabled")


class ConfigResponse(BaseModel):
    """Response model for server config."""

    rag: RAGConfigResponse = Field(..., description="The config of the RAG")
    models: dict[str, list[str]] = Field(..., description="The configured models")
    auth: AuthConfigResponse = Field(
        default_factory=lambda: AuthConfigResponse(enabled=False),
        description="The auth config",
    )
