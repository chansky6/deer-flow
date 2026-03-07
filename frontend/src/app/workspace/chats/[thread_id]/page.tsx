"use client";

import type { Message } from "@langchain/langgraph-sdk";
import { FilesIcon, XIcon } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ConversationEmptyState } from "@/components/ai-elements/conversation";
import { usePromptInputController } from "@/components/ai-elements/prompt-input";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useSidebar } from "@/components/ui/sidebar";
import {
  ArtifactFileDetail,
  ArtifactFileList,
  useArtifacts,
} from "@/components/workspace/artifacts";
import { InputBox } from "@/components/workspace/input-box";
import { MessageList } from "@/components/workspace/messages";
import { ThreadContext } from "@/components/workspace/messages/context";
import { ThreadTitle } from "@/components/workspace/thread-title";
import { TodoList } from "@/components/workspace/todo-list";
import { Tooltip } from "@/components/workspace/tooltip";
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
  type UseThreadStreamResult,
  useConfirmFrameworkReview,
  useSubmitThread,
  useThreadStream,
} from "@/core/threads/hooks";
import {
  pathOfThread,
  textOfMessage,
} from "@/core/threads/utils";
import { uuid } from "@/core/utils/uuid";
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

function isPlainAssistantTextMessage(message: Message) {
  return message.type === "ai" && hasContent(message) && !hasToolCalls(message);
}

function findFrameworkReviewDraftMessageId({
  messages,
  includeStreamingFallback,
}: {
  messages: Message[];
  includeStreamingFallback: boolean;
}) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (!isFrameworkReviewRequestMessage(messages[index]!)) {
      continue;
    }

    for (let candidateIndex = index - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = messages[candidateIndex]!;
      if (isPlainAssistantTextMessage(candidate)) {
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
    if (isPlainAssistantTextMessage(candidate)) {
      return candidate.id;
    }
  }

  return undefined;
}

export default function ChatPage() {
  const { t } = useI18n();
  const router = useRouter();
  const [settings, setSettings] = useLocalSettings();
  const { setOpen: setSidebarOpen } = useSidebar();
  const {
    artifacts,
    open: artifactsOpen,
    setOpen: setArtifactsOpen,
    setArtifacts,
    select: selectArtifact,
    selectedArtifact,
  } = useArtifacts();
  const { thread_id: threadIdFromPath } = useParams<{ thread_id: string }>();
  const searchParams = useSearchParams();
  const promptInputController = usePromptInputController();
  const inputInitialValue = useMemo(() => {
    if (threadIdFromPath !== "new" || searchParams.get("mode") !== "skill") {
      return undefined;
    }
    return t.inputBox.createSkillPrompt;
  }, [threadIdFromPath, searchParams, t.inputBox.createSkillPrompt]);
  const lastInitialValueRef = useRef<string | undefined>(undefined);
  const setInputRef = useRef(promptInputController.textInput.setInput);
  setInputRef.current = promptInputController.textInput.setInput;
  useEffect(() => {
    if (inputInitialValue && inputInitialValue !== lastInitialValueRef.current) {
      lastInitialValueRef.current = inputInitialValue;
      setTimeout(() => {
        setInputRef.current(inputInitialValue);
        const textarea = document.querySelector("textarea");
        if (textarea) {
          textarea.focus();
          textarea.selectionStart = textarea.value.length;
          textarea.selectionEnd = textarea.value.length;
        }
      }, 100);
    }
  }, [inputInitialValue]);
  const isNewThread = useMemo(
    () => threadIdFromPath === "new",
    [threadIdFromPath],
  );
  const [threadId, setThreadId] = useState<string | null>(null);
  useEffect(() => {
    if (threadIdFromPath !== "new") {
      setThreadId(threadIdFromPath);
    } else {
      setThreadId(uuid());
    }
  }, [threadIdFromPath]);

  const { showNotification } = useNotification();
  const [finalState, setFinalState] = useState<AgentThreadState | null>(null);
  const thread = useThreadStream({
    isNewThread,
    threadId,
    onFinish: (state) => {
      setFinalState(state);
      if (document.hidden || !document.hasFocus()) {
        let body = "Conversation finished";
        const lastMessage = state.messages.at(-1);
        if (lastMessage) {
          const textContent = textOfMessage(lastMessage);
          if (textContent) {
            if (textContent.length > 200) {
              body = textContent.substring(0, 200) + "...";
            } else {
              body = textContent;
            }
          }
        }
        showNotification(state.title, {
          body,
        });
      }
    },
  }) as UseThreadStreamResult;
  useEffect(() => {
    if (thread.isLoading) setFinalState(null);
  }, [thread.isLoading]);

  const title = thread.values?.title ?? "Untitled";
  useEffect(() => {
    const pageTitle = isNewThread
      ? t.pages.newChat
      : thread.isThreadLoading
        ? "Loading..."
        : title === "Untitled" ? t.pages.untitled : title;
    document.title = `${pageTitle} - ${t.pages.appName}`;
  }, [
    isNewThread,
    t.pages.newChat,
    t.pages.untitled,
    t.pages.appName,
    title,
    thread.isThreadLoading,
  ]);

  const [autoSelectFirstArtifact, setAutoSelectFirstArtifact] = useState(true);
  useEffect(() => {
    setArtifacts(thread.values.artifacts);
    if (
      env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" &&
      autoSelectFirstArtifact
    ) {
      if (thread?.values?.artifacts?.length > 0) {
        setAutoSelectFirstArtifact(false);
        selectArtifact(thread.values.artifacts[0]!);
      }
    }
  }, [
    autoSelectFirstArtifact,
    selectArtifact,
    setArtifacts,
    thread.values.artifacts,
  ]);

  const artifactPanelOpen = useMemo(() => {
    if (env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true") {
      return artifactsOpen && artifacts?.length > 0;
    }
    return artifactsOpen;
  }, [artifactsOpen, artifacts]);

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
  const isFrameworkReviewPending = activeFrameworkReview?.status === "pending";
  const confirmedFrameworkMarkdown =
    thread.values.confirmed_analysis_framework?.markdown ??
    optimisticConfirmedFrameworkMarkdown;
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
  const visibleMessages = useMemo(() => {
    if (!frameworkReviewDraftMessageId) {
      return sourceMessages;
    }

    return sourceMessages.filter(
      (message) => message.id !== frameworkReviewDraftMessageId,
    );
  }, [sourceMessages, frameworkReviewDraftMessageId]);
  const streamingFrameworkReview =
    useMemo<StreamingFrameworkReviewState | null>(() => {
      if (!thread.isLoading || !thread.streamingFrameworkReview) {
        return null;
      }

      const draftMessage = frameworkReviewDraftMessageId
        ? sourceMessages.find(
            (message) => message.id === frameworkReviewDraftMessageId,
          )
        : undefined;

      return {
        ...thread.streamingFrameworkReview,
        draft_markdown: draftMessage
          ? extractContentFromMessage(draftMessage)
          : "",
      };
    }, [
      frameworkReviewDraftMessageId,
      sourceMessages,
      thread.isLoading,
      thread.streamingFrameworkReview,
    ]);

  useEffect(() => {
    if (thread.values.confirmed_analysis_framework?.markdown) {
      setOptimisticConfirmedFrameworkMarkdown(null);
    }
  }, [thread.values.confirmed_analysis_framework?.markdown]);

  const handleSubmit = useSubmitThread({
    isNewThread,
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
    afterSubmit() {
      router.push(pathOfThread(threadId!));
    },
  });
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
      router.push(pathOfThread(threadId!));
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

  if (!threadId) {
    return null;
  }

  return (
    <ThreadContext.Provider value={{ threadId, thread }}>
      <ResizablePanelGroup orientation="horizontal">
        <ResizablePanel
          className="relative"
          defaultSize={artifactPanelOpen ? 46 : 100}
          minSize={artifactPanelOpen ? 30 : 100}
        >
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
                {title !== "Untitled" && (
                  <ThreadTitle threadId={threadId} threadTitle={title} />
                )}
              </div>
              <div>
                {artifacts?.length > 0 && !artifactsOpen && (
                  <Tooltip content="Show artifacts of this conversation">
                    <Button
                      className="text-muted-foreground hover:text-foreground"
                      variant="ghost"
                      onClick={() => {
                        setArtifactsOpen(true);
                        setSidebarOpen(false);
                      }}
                    >
                      <FilesIcon />
                      {t.common.artifacts}
                    </Button>
                  </Tooltip>
                )}
              </div>
            </header>
            <main className="flex min-h-0 max-w-full grow flex-col">
              <div className="flex size-full justify-center">
                <MessageList
                  className={cn("size-full", !isNewThread && "pt-10")}
                  threadId={threadId}
                  thread={thread}
                  messages={visibleMessages}
                  paddingBottom={todoListCollapsed ? 160 : 280}
                  streamingFrameworkReview={streamingFrameworkReview}
                  frameworkReview={activeFrameworkReview}
                  confirmedFrameworkMarkdown={confirmedFrameworkMarkdown}
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
                          !thread.values.todos ||
                          thread.values.todos.length === 0
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
                    autoFocus={isNewThread}
                    status={thread.isLoading ? "streaming" : "ready"}
                    context={settings.context}
                    extraHeader={
                      isNewThread && <Welcome mode={settings.context.mode} />
                    }
                    disabled={env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY === "true" || isFrameworkReviewPending}
                    onContextChange={(context) =>
                      setSettings("context", context)
                    }
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
        </ResizablePanel>
        <ResizableHandle
          className={cn(
            "opacity-33 hover:opacity-100",
            !artifactPanelOpen && "pointer-events-none opacity-0",
          )}
        />
        <ResizablePanel
          className={cn(
            "transition-all duration-300 ease-in-out",
            !artifactsOpen && "opacity-0",
          )}
          defaultSize={artifactPanelOpen ? 64 : 0}
          minSize={0}
          maxSize={artifactPanelOpen ? undefined : 0}
        >
          <div
            className={cn(
              "h-full p-4 transition-transform duration-300 ease-in-out",
              artifactPanelOpen ? "translate-x-0" : "translate-x-full",
            )}
          >
            {selectedArtifact ? (
              <ArtifactFileDetail
                className="size-full"
                filepath={selectedArtifact}
                threadId={threadId}
              />
            ) : (
              <div className="relative flex size-full justify-center">
                <div className="absolute top-1 right-1 z-30">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => {
                      setArtifactsOpen(false);
                    }}
                  >
                    <XIcon />
                  </Button>
                </div>
                {thread.values.artifacts?.length === 0 ? (
                  <ConversationEmptyState
                    icon={<FilesIcon />}
                    title="No artifact selected"
                    description="Select an artifact to view its details"
                  />
                ) : (
                  <div className="flex size-full max-w-(--container-width-sm) flex-col justify-center p-4 pt-8">
                    <header className="shrink-0">
                      <h2 className="text-lg font-medium">Artifacts</h2>
                    </header>
                    <main className="min-h-0 grow">
                      <ArtifactFileList
                        className="max-w-(--container-width-sm) p-4 pt-12"
                        files={thread.values.artifacts ?? []}
                        threadId={threadId}
                      />
                    </main>
                  </div>
                )}
              </div>
            )}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </ThreadContext.Provider>
  );
}
