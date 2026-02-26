import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  loadMemoryConfig,
  loadModelsConfig,
  loadSandboxConfig,
  loadSubagentsConfig,
  loadSummarizationConfig,
  loadTitleConfig,
  loadToolGroupsConfig,
  loadToolsConfig,
  updateMemoryConfig,
  updateModelsConfig,
  updateSandboxConfig,
  updateSubagentsConfig,
  updateSummarizationConfig,
  updateTitleConfig,
  updateToolGroupsConfig,
  updateToolsConfig,
} from "./api";
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

// --- Generic hook factory ---

function useConfigQuery<T>(key: string, fn: () => Promise<T>) {
  const { data, isLoading, error } = useQuery({ queryKey: [key], queryFn: fn });
  return { data, isLoading, error };
}

function useConfigMutation<T>(key: string, fn: (data: T) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

// --- Models ---

export function useModelsConfig() {
  return useConfigQuery("adminModels", loadModelsConfig);
}

export function useUpdateModelsConfig() {
  return useConfigMutation<ModelConfig[]>("adminModels", updateModelsConfig);
}

// --- Tools ---

export function useToolsConfig() {
  return useConfigQuery("adminTools", loadToolsConfig);
}

export function useUpdateToolsConfig() {
  return useConfigMutation<ToolConfig[]>("adminTools", updateToolsConfig);
}

// --- Tool Groups ---

export function useToolGroupsConfig() {
  return useConfigQuery("adminToolGroups", loadToolGroupsConfig);
}

export function useUpdateToolGroupsConfig() {
  return useConfigMutation<ToolGroupConfig[]>(
    "adminToolGroups",
    updateToolGroupsConfig,
  );
}

// --- Sandbox ---

export function useSandboxConfig() {
  return useConfigQuery("adminSandbox", loadSandboxConfig);
}

export function useUpdateSandboxConfig() {
  return useConfigMutation<SandboxConfig>("adminSandbox", updateSandboxConfig);
}

// --- Memory ---

export function useMemoryAdminConfig() {
  return useConfigQuery("adminMemory", loadMemoryConfig);
}

export function useUpdateMemoryConfig() {
  return useConfigMutation<MemoryConfig>("adminMemory", updateMemoryConfig);
}

// --- Title ---

export function useTitleConfig() {
  return useConfigQuery("adminTitle", loadTitleConfig);
}

export function useUpdateTitleConfig() {
  return useConfigMutation<TitleConfig>("adminTitle", updateTitleConfig);
}

// --- Summarization ---

export function useSummarizationConfig() {
  return useConfigQuery("adminSummarization", loadSummarizationConfig);
}

export function useUpdateSummarizationConfig() {
  return useConfigMutation<SummarizationConfig>(
    "adminSummarization",
    updateSummarizationConfig,
  );
}

// --- Subagents ---

export function useSubagentsConfig() {
  return useConfigQuery("adminSubagents", loadSubagentsConfig);
}

export function useUpdateSubagentsConfig() {
  return useConfigMutation<SubagentsConfig>(
    "adminSubagents",
    updateSubagentsConfig,
  );
}
