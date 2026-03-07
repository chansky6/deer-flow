import type { HumanMessage } from "@langchain/core/messages";
import type { AIMessage } from "@langchain/langgraph-sdk";
import type { ThreadsClient } from "@langchain/langgraph-sdk/client";
import { useStream, type UseStream } from "@langchain/langgraph-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

import { getAPIClient } from "../api";
import { useUpdateSubtask } from "../tasks/context";
import { uploadFiles } from "../uploads";

import type {
  AgentThread,
  AgentThreadContext,
  AgentThreadState,
  FrameworkReviewDraftStartedEvent,
  StreamingFrameworkReviewMeta,
} from "./types";

export type UseThreadStreamResult = UseStream<AgentThreadState> & {
  streamingFrameworkReview: StreamingFrameworkReviewMeta | null;
};

async function submitThreadTextMessage({
  thread,
  text,
  threadId,
  submitThreadId,
  threadContext,
}: {
  thread: UseStream<AgentThreadState>;
  text: string;
  threadId: string | null | undefined;
  submitThreadId?: string;
  threadContext: Omit<AgentThreadContext, "thread_id">;
}) {
  await thread.submit(
    {
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
  isNewThread,
  onFinish,
}: {
  isNewThread: boolean;
  threadId: string | null | undefined;
  onFinish?: (state: AgentThreadState) => void;
}) {
  const queryClient = useQueryClient();
  const updateSubtask = useUpdateSubtask();
  const [streamingFrameworkReview, setStreamingFrameworkReview] =
    useState<StreamingFrameworkReviewMeta | null>(null);

  // Demo thread IDs from showcase
  const DEMO_THREAD_IDS = [
    "7cfa5f8f-a2f8-47ad-acbd-da7137baf990",
    "4f3e55ee-f853-43db-bfb3-7d1a411f03cb",
    "21cfea46-34bd-4aa6-9e1f-3009452fbeb9",
    "ad76c455-5bf9-4335-8517-fc03834ab828",
    "d3e5adaf-084c-4dd5-9d29-94f1d6bccd98",
    "3823e443-4e2b-4679-b496-a9506eae462b",
  ];

  const isDemoThread = threadId && DEMO_THREAD_IDS.includes(threadId);
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
    client: getAPIClient(),
    assistantId: "lead_agent",
    threadId: isDemoThread ? undefined : (isNewThread ? undefined : threadId),
    reconnectOnMount: !isDemoThread,
    fetchStateHistory: isDemoThread ? false : { limit: 1 },
    onCustomEvent(event: unknown) {
      console.info(event);
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
      // void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
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

  // Return demo state if available
  if (demoState) {
    return Object.assign(thread, {
      streamingFrameworkReview: null,
      values: demoState,
      messages: demoState.messages || [],
      isLoading: false,
      isThreadLoading: false,
      history: [],
    });
  }

  return Object.assign(thread, {
    streamingFrameworkReview,
  });
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

      // Upload files first if any
      if (message.files && message.files.length > 0) {
        try {
          // Convert FileUIPart to File objects by fetching blob URLs
          const filePromises = message.files.map(async (fileUIPart) => {
            if (fileUIPart.url && fileUIPart.filename) {
              try {
                // Fetch the blob URL to get the file data
                const response = await fetch(fileUIPart.url);
                const blob = await response.blob();

                // Create a File object from the blob
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
      }).catch((error) => {
        console.error("Failed to continue automatically after framework confirmation:", error);
        toast.error(autoContinueErrorMessage);
      });

      void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
      afterSubmit?.();
    },
  });
}
