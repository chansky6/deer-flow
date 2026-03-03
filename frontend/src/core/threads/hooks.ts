import type { HumanMessage } from "@langchain/core/messages";
import type { AIMessage } from "@langchain/langgraph-sdk";
import type { ThreadsClient } from "@langchain/langgraph-sdk/client";
import { useStream, type UseStream } from "@langchain/langgraph-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

import { getAPIClient } from "../api";
import type { LocalSettings } from "../settings";
import { useUpdateSubtask } from "../tasks/context";
import { uploadFiles } from "../uploads";

import type {
  AgentThread,
  AgentThreadContext,
  AgentThreadState,
  FrameworkReviewDraftStartedEvent,
  StreamingFrameworkReviewMeta,
} from "./types";

export type ToolEndEvent = {
  name: string;
  data: unknown;
};

export type ThreadStreamOptions = {
  threadId?: string | null | undefined;
  context: LocalSettings["context"];
  isMock?: boolean;
  onStart?: (threadId: string) => void;
  onFinish?: (state: AgentThreadState) => void;
  onToolEnd?: (event: ToolEndEvent) => void;
};

export type UseThreadStreamResult = UseStream<AgentThreadState> & {
  streamingFrameworkReview: StreamingFrameworkReviewMeta | null;
};

async function submitThreadTextMessage({
  thread,
  text,
  threadId,
  submitThreadId,
  threadContext,
  statePatch,
}: {
  thread: UseStream<AgentThreadState>;
  text: string;
  threadId: string | null | undefined;
  submitThreadId?: string;
  threadContext: Omit<AgentThreadContext, "thread_id">;
  statePatch?: Omit<Partial<AgentThreadState>, "messages">;
}) {
  await thread.submit(
    {
      ...(statePatch ?? {}),
      messages: [
        {
          type: "human",
          content: [
            {
              type: "text",
              text,
            },
          ],
        },
      ] as HumanMessage[],
    },
    {
      threadId: submitThreadId,
      streamSubgraphs: true,
      streamResumable: true,
      streamMode: ["values", "messages-tuple", "custom"],
      config: {
        recursion_limit: 1000,
      },
      context: {
        ...threadContext,
        thread_id: threadId,
      },
    },
  );
}

export function useThreadStream({
  threadId,
  context,
  isMock,
  onStart,
  onFinish,
  onToolEnd,
}: ThreadStreamOptions) {
  const [_threadId, setThreadId] = useState<string | null>(threadId ?? null);
  const queryClient = useQueryClient();
  const updateSubtask = useUpdateSubtask();
  const [streamingFrameworkReview, setStreamingFrameworkReview] =
    useState<StreamingFrameworkReviewMeta | null>(null);

  const DEMO_THREAD_IDS = [
    "7cfa5f8f-a2f8-47ad-acbd-da7137baf990",
    "4f3e55ee-f853-43db-bfb3-7d1a411f03cb",
    "21cfea46-34bd-4aa6-9e1f-3009452fbeb9",
    "ad76c455-5bf9-4335-8517-fc03834ab828",
    "d3e5adaf-084c-4dd5-9d29-94f1d6bccd98",
    "3823e443-4e2b-4679-b496-a9506eae462b",
  ];

  const isDemoThread = Boolean(threadId && DEMO_THREAD_IDS.includes(threadId));
  const [demoState, setDemoState] = useState<AgentThreadState | null>(null);

  useEffect(() => {
    if (isDemoThread && threadId) {
      fetch(`/demo/threads/${threadId}/thread.json`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.values) {
            setDemoState(data.values);
            onFinish?.(data.values);
          }
        })
        .catch(() => setDemoState(null));
    }
  }, [isDemoThread, threadId, onFinish]);

  const thread = useStream<AgentThreadState>({
    client: getAPIClient(isMock),
    assistantId: "lead_agent",
    threadId: isDemoThread ? undefined : _threadId,
    reconnectOnMount: !isDemoThread,
    fetchStateHistory: isDemoThread ? false : { limit: 1 },
    onCreated(meta) {
      setThreadId(meta.thread_id);
      onStart?.(meta.thread_id);
    },
    onLangChainEvent(event) {
      if (event.event === "on_tool_end") {
        onToolEnd?.({
          name: event.name,
          data: event.data,
        });
      }
    },
    onCustomEvent(event: unknown) {
      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "framework_review_draft_started"
      ) {
        const e = event as FrameworkReviewDraftStartedEvent;
        setStreamingFrameworkReview({
          kind: e.kind,
          status: "streaming",
          review_title: e.review_title,
          instructions: e.instructions,
        });
        return;
      }

      if (
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        event.type === "task_running"
      ) {
        const e = event as {
          type: "task_running";
          task_id: string;
          message: AIMessage;
        };
        updateSubtask({ id: e.task_id, latestMessage: e.message });
      }
    },
    onFinish(state) {
      setStreamingFrameworkReview(null);
      onFinish?.(state.values);
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: Array<AgentThread>) => {
          return oldData.map((t) => {
            if (t.thread_id === (_threadId ?? threadId)) {
              return {
                ...t,
                values: {
                  ...t.values,
                  title: state.values.title,
                },
              };
            }
            return t;
          });
        },
      );
    },
  });

  const threadWithMeta = Object.assign(thread, {
    streamingFrameworkReview,
  }) as UseThreadStreamResult;

  const resultThread = demoState
    ? (Object.assign(thread, {
        streamingFrameworkReview: null,
        values: demoState,
        messages: demoState.messages || [],
        isLoading: false,
        isThreadLoading: false,
        history: [],
      }) as UseThreadStreamResult)
    : threadWithMeta;

  const sendMessage = useCallback(
    async (
      targetThreadId: string,
      message: PromptInputMessage,
      extraContext?: Record<string, unknown>,
    ) => {
      const text = message.text.trim();

      if (message.files && message.files.length > 0) {
        try {
          const filePromises = message.files.map(async (fileUIPart) => {
            if (fileUIPart.url && fileUIPart.filename) {
              try {
                const response = await fetch(fileUIPart.url);
                const blob = await response.blob();

                return new File([blob], fileUIPart.filename, {
                  type: fileUIPart.mediaType || blob.type,
                });
              } catch (error) {
                console.error(
                  `Failed to fetch file ${fileUIPart.filename}:`,
                  error,
                );
                return null;
              }
            }
            return null;
          });

          const conversionResults = await Promise.all(filePromises);
          const files = conversionResults.filter(
            (file): file is File => file !== null,
          );
          const failedConversions = conversionResults.length - files.length;

          if (failedConversions > 0) {
            throw new Error(
              `Failed to prepare ${failedConversions} attachment(s) for upload. Please retry.`,
            );
          }

          if (!targetThreadId) {
            throw new Error("Thread is not ready for file upload.");
          }

          if (files.length > 0) {
            await uploadFiles(targetThreadId, files);
          }
        } catch (error) {
          console.error("Failed to upload files:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Failed to upload files.";
          toast.error(errorMessage);
          throw error;
        }
      }

      await submitThreadTextMessage({
        thread,
        text,
        threadId: targetThreadId,
        submitThreadId: _threadId ?? targetThreadId,
        threadContext: {
          ...extraContext,
          ...context,
          thinking_enabled: context.mode !== "flash",
          is_plan_mode: context.mode === "pro" || context.mode === "ultra",
          subagent_enabled: context.mode === "ultra",
          reasoning_effort: context.reasoning_effort,
        },
      });
      void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
    },
    [thread, _threadId, context, queryClient],
  );

  return [resultThread, sendMessage] as const;
}

export function useSubmitThread({
  threadId,
  thread,
  threadContext,
  isNewThread,
  afterSubmit,
}: {
  isNewThread: boolean;
  threadId: string | null | undefined;
  thread: UseStream<AgentThreadState>;
  threadContext: Omit<AgentThreadContext, "thread_id">;
  afterSubmit?: () => void;
}) {
  const queryClient = useQueryClient();
  const callback = useCallback(
    async (message: PromptInputMessage) => {
      const text = message.text.trim();

      if (message.files && message.files.length > 0) {
        try {
          const filePromises = message.files.map(async (fileUIPart) => {
            if (fileUIPart.url && fileUIPart.filename) {
              try {
                const response = await fetch(fileUIPart.url);
                const blob = await response.blob();

                return new File([blob], fileUIPart.filename, {
                  type: fileUIPart.mediaType || blob.type,
                });
              } catch (error) {
                console.error(
                  `Failed to fetch file ${fileUIPart.filename}:`,
                  error,
                );
                return null;
              }
            }
            return null;
          });

          const conversionResults = await Promise.all(filePromises);
          const files = conversionResults.filter(
            (file): file is File => file !== null,
          );
          const failedConversions = conversionResults.length - files.length;

          if (failedConversions > 0) {
            throw new Error(
              `Failed to prepare ${failedConversions} attachment(s) for upload. Please retry.`,
            );
          }

          if (!threadId) {
            throw new Error("Thread is not ready for file upload.");
          }

          if (files.length > 0) {
            await uploadFiles(threadId, files);
          }
        } catch (error) {
          console.error("Failed to upload files:", error);
          const errorMessage =
            error instanceof Error ? error.message : "Failed to upload files.";
          toast.error(errorMessage);
          throw error;
        }
      }

      await submitThreadTextMessage({
        thread,
        text,
        threadId,
        submitThreadId: isNewThread ? threadId! : undefined,
        threadContext,
      });
      void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
      afterSubmit?.();
    },
    [thread, isNewThread, threadId, threadContext, queryClient, afterSubmit],
  );
  return callback;
}

export function useThreads(
  params: Parameters<ThreadsClient["search"]>[0] = {
    limit: 50,
    sortBy: "updated_at",
    sortOrder: "desc",
    select: ["thread_id", "updated_at", "values"],
  },
) {
  const apiClient = getAPIClient();
  return useQuery<AgentThread[]>({
    queryKey: ["threads", "search", params],
    queryFn: async () => {
      const response = await apiClient.threads.search<AgentThreadState>(params);
      return response as AgentThread[];
    },
    refetchOnWindowFocus: false,
  });
}

export function useDeleteThread() {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();
  return useMutation({
    mutationFn: async ({ threadId }: { threadId: string }) => {
      await apiClient.threads.delete(threadId);
    },
    onSuccess(_, { threadId }) {
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: Array<AgentThread>) => {
          return oldData.filter((t) => t.thread_id !== threadId);
        },
      );
    },
  });
}

export function useRenameThread() {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();
  return useMutation({
    mutationFn: async ({
      threadId,
      title,
    }: {
      threadId: string;
      title: string;
    }) => {
      await apiClient.threads.updateState(threadId, {
        values: { title },
      });
    },
    onSuccess(_, { threadId, title }) {
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: Array<AgentThread>) => {
          return oldData.map((t) => {
            if (t.thread_id === threadId) {
              return {
                ...t,
                values: {
                  ...t.values,
                  title,
                },
              };
            }
            return t;
          });
        },
      );
    },
  });
}

export function useConfirmFrameworkReview({
  threadId,
  thread,
  threadContext,
  isNewThread,
  continuePrompt,
  confirmErrorMessage,
  autoContinueErrorMessage,
  afterSubmit,
}: {
  threadId: string | null | undefined;
  thread: UseStream<AgentThreadState>;
  threadContext: Omit<AgentThreadContext, "thread_id">;
  isNewThread: boolean;
  continuePrompt: string;
  confirmErrorMessage: string;
  autoContinueErrorMessage: string;
  afterSubmit?: () => void;
}) {
  const queryClient = useQueryClient();
  const apiClient = getAPIClient();

  return useMutation({
    mutationFn: async ({
      toolCallId,
      markdown,
    }: {
      toolCallId: string;
      markdown: string;
    }) => {
      if (!threadId) {
        throw new Error(confirmErrorMessage);
      }

      try {
        await apiClient.threads.updateState(threadId, {
          values: {
            framework_review: null,
            confirmed_analysis_framework: {
              tool_call_id: toolCallId,
              markdown,
            },
          },
        });
      } catch (error) {
        console.error("Failed to confirm framework review:", error);
        toast.error(confirmErrorMessage);
        throw error;
      }

      void submitThreadTextMessage({
        thread,
        text: continuePrompt,
        threadId,
        submitThreadId: isNewThread ? threadId : undefined,
        threadContext,
        statePatch: {
          framework_review: null,
          confirmed_analysis_framework: {
            tool_call_id: toolCallId,
            markdown,
          },
        },
      }).catch((error) => {
        console.error("Failed to continue automatically after framework confirmation:", error);
        toast.error(autoContinueErrorMessage);
      });

      void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
      afterSubmit?.();
    },
  });
}
