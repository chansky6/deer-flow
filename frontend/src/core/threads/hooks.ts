import type { AIMessage, Message } from "@langchain/langgraph-sdk";
import type { ThreadsClient } from "@langchain/langgraph-sdk/client";
import { useStream, type UseStream } from "@langchain/langgraph-sdk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { PromptInputMessage } from "@/components/ai-elements/prompt-input";

import { getAPIClient } from "../api";
import { useI18n } from "../i18n/hooks";
import type { FileInMessage } from "../messages/utils";
import type { LocalSettings } from "../settings";
import { useUpdateSubtask } from "../tasks/context";
import type { UploadedFileInfo } from "../uploads";
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
          content: text ? [{ type: "text", text }] : "",
        } satisfies Message,
      ],
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
  const { t } = useI18n();
  const [onStreamThreadId, setOnStreamThreadId] = useState<
    string | null | undefined
  >(() => threadId);
  const threadIdRef = useRef<string | null>(threadId ?? null);
  const startedRef = useRef(false);
  const listeners = useRef({
    onStart,
    onFinish,
    onToolEnd,
  });

  useEffect(() => {
    listeners.current = { onStart, onFinish, onToolEnd };
  }, [onStart, onFinish, onToolEnd]);

  useEffect(() => {
    const normalizedThreadId = threadId ?? null;
    if (threadIdRef.current !== normalizedThreadId) {
      threadIdRef.current = normalizedThreadId;
      startedRef.current = false;
      setOnStreamThreadId(normalizedThreadId);
    }
  }, [threadId]);

  const handleOnStart = useCallback((id: string) => {
    if (!startedRef.current) {
      listeners.current.onStart?.(id);
      startedRef.current = true;
    }
  }, []);

  const handleStreamStart = useCallback(
    (nextThreadId: string) => {
      threadIdRef.current = nextThreadId;
      setOnStreamThreadId(nextThreadId);
      handleOnStart(nextThreadId);
    },
    [handleOnStart],
  );

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
            listeners.current.onFinish?.(data.values);
          }
        })
        .catch(() => setDemoState(null));
    }
  }, [isDemoThread, threadId]);

  const thread = useStream<AgentThreadState>({
    client: getAPIClient(isMock),
    assistantId: "lead_agent",
    threadId: isDemoThread ? undefined : onStreamThreadId,
    reconnectOnMount: !isDemoThread,
    fetchStateHistory: isDemoThread ? false : { limit: 1 },
    onCreated(meta) {
      handleStreamStart(meta.thread_id);
    },
    onLangChainEvent(event) {
      if (event.event === "on_tool_end") {
        listeners.current.onToolEnd?.({
          name: event.name,
          data: event.data,
        });
      }
    },
    onUpdateEvent(data) {
      const updates: Array<Partial<AgentThreadState> | null> = Object.values(
        data || {},
      );
      for (const update of updates) {
        if (update && "title" in update && update.title) {
          void queryClient.setQueriesData(
            {
              queryKey: ["threads", "search"],
              exact: false,
            },
            (oldData: Array<AgentThread> | undefined) => {
              return oldData?.map((t) => {
                if (t.thread_id === threadIdRef.current) {
                  return {
                    ...t,
                    values: {
                      ...t.values,
                      title: update.title,
                    },
                  };
                }
                return t;
              });
            },
          );
        }
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
      listeners.current.onFinish?.(state.values);
      queryClient.setQueriesData(
        {
          queryKey: ["threads", "search"],
          exact: false,
        },
        (oldData: Array<AgentThread> | undefined) => {
          return oldData?.map((t) => {
            if (t.thread_id === threadIdRef.current) {
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
      void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
    },
  });

  const [optimisticMessages, setOptimisticMessages] = useState<Message[]>([]);
  const prevMsgCountRef = useRef(thread.messages.length);

  useEffect(() => {
    if (
      optimisticMessages.length > 0 &&
      thread.messages.length > prevMsgCountRef.current
    ) {
      setOptimisticMessages([]);
    }
  }, [thread.messages.length, optimisticMessages.length]);

  const sendMessage = useCallback(
    async (
      targetThreadId: string,
      message: PromptInputMessage,
      extraContext?: Record<string, unknown>,
    ) => {
      const text = message.text.trim();

      prevMsgCountRef.current = thread.messages.length;

      const optimisticFiles: FileInMessage[] = (message.files ?? []).map(
        (filePart) => ({
          filename: filePart.filename ?? "",
          size: 0,
          status: "uploading" as const,
        }),
      );

      const optimisticHumanMsg: Message = {
        type: "human",
        id: `opt-human-${Date.now()}`,
        content: text ? [{ type: "text", text }] : "",
        additional_kwargs:
          optimisticFiles.length > 0 ? { files: optimisticFiles } : {},
      };

      const newOptimistic: Message[] = [optimisticHumanMsg];
      if (optimisticFiles.length > 0) {
        newOptimistic.push({
          type: "ai",
          id: `opt-ai-${Date.now()}`,
          content: t.uploads.uploadingFiles,
          additional_kwargs: { element: "task" },
        });
      }
      setOptimisticMessages(newOptimistic);

      handleOnStart(targetThreadId);

      let uploadedFileInfo: UploadedFileInfo[] = [];

      try {
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
              const uploadResponse = await uploadFiles(targetThreadId, files);
              uploadedFileInfo = uploadResponse.files;

              const uploadedFiles: FileInMessage[] = uploadedFileInfo.map(
                (info) => ({
                  filename: info.filename,
                  size: info.size,
                  path: info.virtual_path,
                  status: "uploaded" as const,
                }),
              );
              setOptimisticMessages((messages) => {
                if (messages.length > 1 && messages[0]) {
                  const humanMessage = messages[0]!;
                  return [
                    {
                      ...humanMessage,
                      additional_kwargs: { files: uploadedFiles },
                    },
                    ...messages.slice(1),
                  ];
                }
                return messages;
              });
            }
          } catch (error) {
            console.error("Failed to upload files:", error);
            const errorMessage =
              error instanceof Error ? error.message : "Failed to upload files.";
            toast.error(errorMessage);
            setOptimisticMessages([]);
            throw error;
          }
        }

        const filesForSubmit: FileInMessage[] = uploadedFileInfo.map((info) => ({
          filename: info.filename,
          size: info.size,
          path: info.virtual_path,
          status: "uploaded" as const,
        }));

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
                additional_kwargs:
                  filesForSubmit.length > 0 ? { files: filesForSubmit } : {},
              },
            ],
          },
          {
            threadId: targetThreadId,
            streamSubgraphs: true,
            streamResumable: true,
            streamMode: ["values", "messages-tuple", "custom"],
            config: {
              recursion_limit: 1000,
            },
            context: {
              ...extraContext,
              ...context,
              thinking_enabled: context.mode !== "flash",
              is_plan_mode: context.mode === "pro" || context.mode === "ultra",
              subagent_enabled: context.mode === "ultra",
              reasoning_effort: context.reasoning_effort,
              thread_id: targetThreadId,
            },
          },
        );
        void queryClient.invalidateQueries({ queryKey: ["threads", "search"] });
      } catch (error) {
        setOptimisticMessages([]);
        throw error;
      }
    },
    [thread, handleOnStart, t.uploads.uploadingFiles, context, queryClient],
  );

  const threadWithMeta = Object.assign(thread, {
    streamingFrameworkReview,
  }) as UseThreadStreamResult;

  const baseThread = demoState
    ? (Object.assign(threadWithMeta, {
        streamingFrameworkReview: null,
        values: demoState,
        messages: demoState.messages || [],
        isLoading: false,
        isThreadLoading: false,
        history: [],
      }) as UseThreadStreamResult)
    : threadWithMeta;

  const resultThread =
    optimisticMessages.length > 0
      ? ({
          ...baseThread,
          messages: [...baseThread.messages, ...optimisticMessages],
        } as UseThreadStreamResult)
      : baseThread;

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
