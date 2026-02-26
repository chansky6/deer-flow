// TypeScript types for admin config API responses

export interface ModelConfig {
  name: string;
  display_name?: string;
  description?: string;
  use: string;
  model?: string;
  api_key?: string;
  api_base?: string;
  max_tokens?: number;
  temperature?: number;
  supports_vision?: boolean;
  supports_thinking?: boolean;
  when_thinking_enabled?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ToolConfig {
  name: string;
  group?: string;
  use: string;
  [key: string]: unknown;
}

export interface ToolGroupConfig {
  name: string;
  [key: string]: unknown;
}

export interface SandboxConfig {
  use: string;
  image?: string;
  port?: number;
  base_url?: string;
  auto_start?: boolean;
  container_prefix?: string;
  idle_timeout?: number;
  mounts?: { host_path: string; container_path: string; read_only?: boolean }[];
  environment?: Record<string, string>;
  [key: string]: unknown;
}

export interface MemoryConfig {
  enabled?: boolean;
  storage_path?: string;
  debounce_seconds?: number;
  model_name?: string | null;
  max_facts?: number;
  fact_confidence_threshold?: number;
  injection_enabled?: boolean;
  max_injection_tokens?: number;
}

export interface TitleConfig {
  enabled?: boolean;
  max_words?: number;
  max_chars?: number;
  model_name?: string | null;
}

export interface SummarizationConfig {
  enabled?: boolean;
  model_name?: string | null;
  trigger?: { type: string; value: number }[] | { type: string; value: number };
  keep?: { type: string; value: number };
  trim_tokens_to_summarize?: number | null;
  summary_prompt?: string | null;
}

export interface SubagentsConfig {
  timeout_seconds?: number;
  agents?: Record<string, { timeout_seconds?: number }>;
}
