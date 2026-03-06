"use client";

import type { Message } from "@langchain/langgraph-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";

import { type PromptInputMessage } from "@/components/ai-elements/prompt-input";
import { ArtifactTrigger } from "@/components/workspace/artifacts";
import {
  ChatBox,
  useSpecificChatMode,
  useThreadChat,
} from "@/components/workspace/chats";
import { InputBox } from "@/components/workspace/input-box";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { Welcome } from "@/components/workspace/welcome";
import { useI18n } from "@/core/i18n/hooks";
import {
  extractContentFromMessage,
  hasContent,
  hasToolCalls,
} from "@/core/messages/utils";
import { useNotification } from "@/core/notification/hooks";
import { useLocalSettings } from "@/core/settings";
import {
  type AgentThreadState,
  type StreamingFrameworkReviewState,
} from "@/core/threads";
import {
  useConfirmFrameworkReview,
  useThreadStream,
} from "@/core/threads/hooks";
import { pathOfThread, textOfMessage } from "@/core/threads/utils";
import { env } from "@/env";
import { cn } from "@/lib/utils";

function isFrameworkReviewRequestMessage(message: Message) {
  if (message.type === "ai") {
    return (message.tool_calls ?? []).some(
      (toolCall) => toolCall.name === "request_framework_review",
    );
  }

  return message.type === "tool" && message.name === "request_framework_review";
}

function isAssistantFrameworkReviewRequestMessage(message: Message) {
  if (message.type === "ai") {
    return (message.tool_calls ?? []).some(
      (toolCall) => toolCall.name === "request_framework_review",
    );
  }

  return false;
}

function isPlainAssistantTextMessage(message: Message) {
  return message.type === "ai" && hasContent(message) && !hasToolCalls(message);
}

function isFrameworkReviewDraftCarrierMessage(message: Message) {
  return (
    isPlainAssistantTextMessage(message) ||
    (isAssistantFrameworkReviewRequestMessage(message) && hasContent(message))
  );
}

function findFrameworkReviewAnchorMessageId({
  messages,
  toolCallId,
}: {
  messages: Message[];
  toolCallId: string | null;
}) {
  if (!toolCallId) {
    return undefined;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (
      message.type === "tool" &&
      message.tool_call_id === toolCallId &&
      message.name === "request_framework_review"
    ) {
      return message.id;
    }
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.type !== "ai") {
      continue;
    }
    if ((message.tool_calls ?? []).some((toolCall) => toolCall.id === toolCallId)) {
      return message.id;
    }
  }

  return undefined;
}

function findFrameworkReviewDraftMessageId({
  messages,
  includeStreamingFallback,
}: {
  messages: Message[];
  includeStreamingFallback: boolean;
}) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const current = messages[index]!;
    if (!isFrameworkReviewRequestMessage(current)) {
      continue;
    }

    if (isFrameworkReviewDraftCarrierMessage(current)) {
      return current.id;
    }

    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = messages[candidateIndex]!;
      if (isFrameworkReviewDraftCarrierMessage(candidate)) {
        return candidate.id;
      }
    }

    return undefined;
  }

  if (!includeStreamingFallback) {
    return undefined;
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = messages[index]!;
    if (isFrameworkReviewDraftCarrierMessage(candidate)) {
      return candidate.id;
    }
  }

  return undefined;
}

export default function ChatPage() {
  const { t } = useI18n();
  const [settings, setSettings] = useLocalSettings();

  const { threadId, isNewThread, setIsNewThread, isMock } = useThreadChat();
  useSpecificChatMode();

  const threadPath = useCallback(
    (id: string) => `${pathOfThread(id)}${isMock ? "?mock=true" : ""}`,
    [isMock],
  );

  const { showNotification } = useNotification();
  const [finalState, setFinalState] = useState<AgentThreadState | null>(null);
  const [thread, sendMessage] = useThreadStream({
    threadId: isNewThread ? undefined : threadId,
    context: settings.context,
    isMock,
    onStart: (createdThreadId) => {
      setIsNewThread(false);
      history.replaceState(null, "", threadPath(createdThreadId));
    },
    onFinish: (state) => {
      setFinalState(state);
      if (document.hidden || !document.hasFocus()) {
        let body = "Conversation finished";
        const lastMessage = state.messages.at(-1);
        if (lastMessage) {
          const textContent = textOfMessage(lastMessage);
          if (textContent) {
            body =
              textContent.length > 200
                ? textContent.substring(0, 200) + "..."
                : textContent;
          }
        }
        showNotification(state.title, { body });
      }
    },
  });

  useEffect(() => {
    if (thread.isLoading) {
      setFinalState(null);
    }
  }, [thread.isLoading]);

  const [todoListCollapsed, setTodoListCollapsed] = useState(true);
  const [dismissedFrameworkReviewId, setDismissedFrameworkReviewId] =
    useState<string | null>(null);
  const [optimisticConfirmedFrameworkMarkdown, setOptimisticConfirmedFrameworkMarkdown] =
    useState<string | null>(null);
  const frameworkReview = thread.values.framework_review ?? null;
  const activeFrameworkReview = useMemo(() => {
    if (frameworkReview?.status !== "pending") {
      return null;
    }
    if (frameworkReview.tool_call_id === dismissedFrameworkReviewId) {
      return null;
    }
    return frameworkReview;
  }, [dismissedFrameworkReviewId, frameworkReview]);
  const confirmedFrameworkMarkdown =
    thread.values.confirmed_analysis_framework?.markdown ??
    optimisticConfirmedFrameworkMarkdown;
  const frameworkReviewToolCallId =
    activeFrameworkReview?.tool_call_id ??
    thread.values.confirmed_analysis_framework?.tool_call_id ??
    dismissedFrameworkReviewId;
  const sourceMessages = useMemo(
    () => ((finalState?.messages as Message[] | undefined) ?? thread.messages),
    [finalState?.messages, thread.messages],
  );
  const frameworkReviewDraftMessageId = useMemo(
    () =>
      findFrameworkReviewDraftMessageId({
        messages: sourceMessages,
        includeStreamingFallback:
          thread.isLoading && thread.streamingFrameworkReview !== null,
      }),
    [sourceMessages, thread.isLoading, thread.streamingFrameworkReview],
  );
  const frameworkReviewDraftMessage = useMemo(
    () =>
      frameworkReviewDraftMessageId
        ? sourceMessages.find((message) => message.id === frameworkReviewDraftMessageId)
        : undefined,
    [frameworkReviewDraftMessageId, sourceMessages],
  );
  const visibleMessages = useMemo(() => {
    if (
      !frameworkReviewDraftMessageId ||
      !frameworkReviewDraftMessage ||
      !isPlainAssistantTextMessage(frameworkReviewDraftMessage)
    ) {
      return sourceMessages;
    }

    return sourceMessages.filter(
      (message) => message.id !== frameworkReviewDraftMessageId,
    );
  }, [
    frameworkReviewDraftMessage,
    frameworkReviewDraftMessageId,
    sourceMessages,
  ]);
  const frameworkReviewAnchorMessageId = useMemo(
    () =>
      findFrameworkReviewAnchorMessageId({
        messages: visibleMessages,
        toolCallId: frameworkReviewToolCallId,
      }),
    [frameworkReviewToolCallId, visibleMessages],
  );
  const frameworkReviewAnchorMessageIndex = useMemo(
    () =>
      frameworkReviewAnchorMessageId
        ? visibleMessages.findIndex(
            (message) => message.id === frameworkReviewAnchorMessageId,
          )
        : -1,
    [frameworkReviewAnchorMessageId, visibleMessages],
  );
  const isFrameworkReviewLocked = useMemo(() => {
    if (!activeFrameworkReview || thread.isLoading) {
      return false;
    }

    if (frameworkReviewAnchorMessageIndex < 0) {
      return false;
    }

    return visibleMessages.length > frameworkReviewAnchorMessageIndex + 1;
  }, [
    activeFrameworkReview,
    frameworkReviewAnchorMessageIndex,
    thread.isLoading,
    visibleMessages.length,
  ]);
  const isFrameworkReviewPending =
    activeFrameworkReview?.status === "pending" && !isFrameworkReviewLocked;
  const streamingFrameworkReview =
    useMemo<StreamingFrameworkReviewState | null>(() => {
      if (!thread.isLoading || !thread.streamingFrameworkReview) {
        return null;
      }

      return {
        ...thread.streamingFrameworkReview,
        draft_markdown: frameworkReviewDraftMessage
          ? extractContentFromMessage(frameworkReviewDraftMessage)
          : "",
      };
    }, [
      frameworkReviewDraftMessage,
      thread.isLoading,
      thread.streamingFrameworkReview,
    ]);

  useEffect(() => {
    if (thread.values.confirmed_analysis_framework?.markdown) {
      setOptimisticConfirmedFrameworkMarkdown(null);
    }
  }, [thread.values.confirmed_analysis_framework?.markdown]);

  const handleSubmit = useCallback(
    (message: PromptInputMessage) => {
      void sendMessage(threadId, message);
    },
    [sendMessage, threadId],
  );
  const {
    mutateAsync: confirmFrameworkReview,
    isPending: isConfirmingFrameworkReview,
  } = useConfirmFrameworkReview({
    threadId,
    thread,
    threadContext: {
      ...settings.context,
      thinking_enabled: settings.context.mode !== "flash",
      is_plan_mode:
        settings.context.mode === "pro" || settings.context.mode === "ultra",
      subagent_enabled: settings.context.mode === "ultra",
      reasoning_effort: settings.context.reasoning_effort,
    },
    isNewThread,
    continuePrompt: t.frameworkReview.continuePrompt,
    confirmErrorMessage: t.frameworkReview.confirmError,
    autoContinueErrorMessage: t.frameworkReview.autoContinueError,
    afterSubmit() {
      history.replaceState(null, "", threadPath(threadId));
    },
  });
  const handleConfirmFrameworkReview = useCallback(
    async (markdown: string) => {
      if (!activeFrameworkReview) {
        return;
      }

      setOptimisticConfirmedFrameworkMarkdown(markdown);
      await confirmFrameworkReview({
        toolCallId: activeFrameworkReview.tool_call_id,
        markdown,
      });
      setDismissedFrameworkReviewId(activeFrameworkReview.tool_call_id);
    },
    [activeFrameworkReview, confirmFrameworkReview],
  );
  const handleStop = useCallback(async () => {
    await thread.stop();
  }, [thread]);

  return (
    <ThreadContext.Provider value={{ thread, isMock }}>
      <ChatBox threadId={threadId}>
        <div className="relative flex size-full min-h-0 justify-between">
          <header
            className={cn(
              "absolute top-0 right-0 left-0 z-30 flex h-12 shrink-0 items-center px-4",
              isNewThread
                ? "bg-background/0 backdrop-blur-none"
                : "bg-background/80 shadow-xs backdrop-blur",
            )}
          >
            <div className="flex w-full items-center text-sm font-medium">
              <ThreadTitle threadId={threadId} thread={thread} />
            </div>
            <div>
              <ArtifactTrigger />
            </div>
          </header>
          <main className="flex min-h-0 max-w-full grow flex-col">
            <div className="flex size-full justify-center">
              <MessageList
                className={cn("size-full", !isNewThread && "pt-10")}
                threadId={threadId}
                thread={thread}
                messages={visibleMessages}
                frameworkReviewInsertionMessageId={frameworkReviewAnchorMessageId}
                paddingBottom={todoListCollapsed ? 160 : 280}
                streamingFrameworkReview={streamingFrameworkReview}
                frameworkReview={activeFrameworkReview}
                confirmedFrameworkMarkdown={confirmedFrameworkMarkdown}
                isFrameworkReviewLocked={isFrameworkReviewLocked}
                isConfirmingFrameworkReview={isConfirmingFrameworkReview}
                onConfirmFrameworkReview={handleConfirmFrameworkReview}
              />
            </div>
            <div className="absolute right-0 bottom-0 left-0 z-30 flex justify-center px-4">
              <div
                className={cn(
                  "relative w-full",
                  isNewThread && "-translate-y-[calc(50vh-96px)]",
                  isNewThread
                    ? "max-w-(--container-width-sm)"
                    : "max-w-(--container-width-md)",
                )}
              >
                <div className="absolute -top-4 right-0 left-0 z-0">
                  <div className="absolute right-0 bottom-0 left-0">
                    <TodoList
                      className="bg-background/5"
                      todos={thread.values.todos ?? []}
                      collapsed={todoListCollapsed}
                      hidden={
                        !thread.values.todos || thread.values.todos.length === 0
                      }
                      onToggle={() =>
                        setTodoListCollapsed(!todoListCollapsed)
                      }
                    />
                  </div>
                </div>
                <InputBox
                  className={cn("bg-background/5 w-full -translate-y-4")}
                  isNewThread={isNewThread}
                  threadId={threadId}
                  autoFocus={isNewThread}
                  status={thread.isLoading ? "streaming" : "ready"}
                  context={settings.context}
                  extraHeader={
                    isNewThread && <Welcome mode={settings.context.mode} />
                  }
                  disabled={
                    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" ||
                    isFrameworkReviewPending
                  }
                  onContextChange={(context) => setSettings("context", context)}
                  onSubmit={handleSubmit}
                  onStop={handleStop}
                />
                {isFrameworkReviewPending && (
                  <div className="text-muted-foreground/80 w-full translate-y-12 text-center text-xs">
                    {t.frameworkReview.completeReviewFirst}
                  </div>
                )}
                {env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" && (
                  <div className="text-muted-foreground/67 w-full translate-y-12 text-center text-xs">
                    {t.common.notAvailableInDemoMode}
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>
      </ChatBox>
    </ThreadContext.Provider>
  );
}
