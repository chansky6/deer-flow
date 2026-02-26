import { getBackendBaseURL } from "@/core/config";

import type {
  MemoryConfig,
  ModelConfig,
  SandboxConfig,
  SubagentsConfig,
  SummarizationConfig,
  TitleConfig,
  ToolConfig,
  ToolGroupConfig,
} from "./types";

const BASE = () => `${getBackendBaseURL()}/api/config`;

// --- Generic helpers ---

async function fetchJson<T>(path: string): Promise<T> {
  const resp = await fetch(`${BASE()}${path}`);
  if (!resp.ok) throw new Error(`GET ${path} failed: ${resp.status}`);
  return resp.json() as Promise<T>;
}

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(`${BASE()}${path}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) throw new Error(`PUT ${path} failed: ${resp.status}`);
  return resp.json() as Promise<T>;
}

// --- Models ---

export const loadModelsConfig = () => fetchJson<ModelConfig[]>("/models");
export const updateModelsConfig = (data: ModelConfig[]) =>
  putJson<{ status: string }>("/models", data);

// --- Tools ---

export const loadToolsConfig = () => fetchJson<ToolConfig[]>("/tools");
export const updateToolsConfig = (data: ToolConfig[]) =>
  putJson<{ status: string }>("/tools", data);

// --- Tool Groups ---

export const loadToolGroupsConfig = () =>
  fetchJson<ToolGroupConfig[]>("/tool-groups");
export const updateToolGroupsConfig = (data: ToolGroupConfig[]) =>
  putJson<{ status: string }>("/tool-groups", data);

// --- Sandbox ---

export const loadSandboxConfig = () => fetchJson<SandboxConfig>("/sandbox");
export const updateSandboxConfig = (data: SandboxConfig) =>
  putJson<{ status: string }>("/sandbox", data);

// --- Memory ---

export const loadMemoryConfig = () => fetchJson<MemoryConfig>("/memory");
export const updateMemoryConfig = (data: MemoryConfig) =>
  putJson<{ status: string }>("/memory", data);

// --- Title ---

export const loadTitleConfig = () => fetchJson<TitleConfig>("/title");
export const updateTitleConfig = (data: TitleConfig) =>
  putJson<{ status: string }>("/title", data);

// --- Summarization ---

export const loadSummarizationConfig = () =>
  fetchJson<SummarizationConfig>("/summarization");
export const updateSummarizationConfig = (data: SummarizationConfig) =>
  putJson<{ status: string }>("/summarization", data);

// --- Subagents ---

export const loadSubagentsConfig = () =>
  fetchJson<SubagentsConfig>("/subagents");
export const updateSubagentsConfig = (data: SubagentsConfig) =>
  putJson<{ status: string }>("/subagents", data);
