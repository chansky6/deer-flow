// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { nanoid } from "nanoid";
import { toast } from "sonner";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";

import { chatStream, chatStreamReconnect, fetchConversations, fetchWorkflowStatus, generatePodcast } from "../api";
import type { Conversation } from "../api/chat";
import { resolveServiceURL } from "../api/resolve-service-url";
import type { ChatEvent } from "../api/types";
import type { Citation, Message, Resource } from "../messages";
import { mergeMessage } from "../messages";
import { parseJSON } from "../utils";

import { getChatStreamSettings } from "./settings-store";

const THREAD_ID_STORAGE_KEY = "deerflow.thread_id";

function getOrCreateThreadId(): string {
  if (typeof window === "undefined") return nanoid();
  try {
    const stored = localStorage.getItem(THREAD_ID_STORAGE_KEY);
    if (stored) return stored;
  } catch {
    // localStorage unavailable
  }
  const id = nanoid();
  try {
    localStorage.setItem(THREAD_ID_STORAGE_KEY, id);
  } catch {
    // localStorage unavailable
  }
  return id;
}

let THREAD_ID = getOrCreateThreadId();

const EVENT_INDEX_STORAGE_KEY = "deerflow.event_index";

function getStoredEventIndex(): number {
  if (typeof window === "undefined") return 0;
  try {
    const stored = localStorage.getItem(EVENT_INDEX_STORAGE_KEY);
    return stored ? parseInt(stored, 10) || 0 : 0;
  } catch {
    return 0;
  }
}

function setStoredEventIndex(index: number) {
  try {
    localStorage.setItem(EVENT_INDEX_STORAGE_KEY, String(index));
  } catch {
    // localStorage unavailable
  }
}

export const useStore = create<{
  responding: boolean;
  threadId: string | undefined;
  messageIds: string[];
  messages: Map<string, Message>;
  researchIds: string[];
  researchPlanIds: Map<string, string>;
  researchReportIds: Map<string, string>;
  researchActivityIds: Map<string, string[]>;
  researchQueries: Map<string, string>;
  researchCitations: Map<string, Citation[]>;
  ongoingResearchId: string | null;
  openResearchId: string | null;
  conversations: Conversation[];
  conversationsLoaded: boolean;

  appendMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  updateMessages: (messages: Message[]) => void;
  openResearch: (researchId: string | null) => void;
  closeResearch: () => void;
  setOngoingResearch: (researchId: string | null) => void;
  setCitations: (researchId: string, citations: Citation[]) => void;
}>((set) => ({
  responding: false,
  threadId: THREAD_ID,
  messageIds: [],
  messages: new Map<string, Message>(),
  researchIds: [],
  researchPlanIds: new Map<string, string>(),
  researchReportIds: new Map<string, string>(),
  researchActivityIds: new Map<string, string[]>(),
  researchQueries: new Map<string, string>(),
  researchCitations: new Map<string, Citation[]>(),
  ongoingResearchId: null,
  openResearchId: null,
  conversations: [],
  conversationsLoaded: false,

  appendMessage(message: Message) {
    set((state) => {
      // Prevent duplicate message IDs in the array to avoid React key warnings
      const newMessageIds = state.messageIds.includes(message.id)
        ? state.messageIds
        : [...state.messageIds, message.id];
      return {
        messageIds: newMessageIds,
        messages: new Map(state.messages).set(message.id, message),
      };
    });
  },
  updateMessage(message: Message) {
    set((state) => ({
      messages: new Map(state.messages).set(message.id, message),
    }));
  },
  updateMessages(messages: Message[]) {
    set((state) => {
      const newMessages = new Map(state.messages);
      messages.forEach((m) => newMessages.set(m.id, m));
      return { messages: newMessages };
    });
  },
  openResearch(researchId: string | null) {
    set({ openResearchId: researchId });
  },
  closeResearch() {
    set({ openResearchId: null });
  },
  setOngoingResearch(researchId: string | null) {
    set({ ongoingResearchId: researchId });
  },
  setCitations(researchId: string, citations: Citation[]) {
    set((state) => ({
      researchCitations: new Map(state.researchCitations).set(researchId, citations),
    }));
  },
}));

/**
 * Shared event processing logic used by both sendMessage and reconnection.
 * Processes a stream of ChatEvents, updating the store as events arrive.
 */
async function processEventStream(
  stream: AsyncIterable<ChatEvent>,
  opts: { interruptFeedback?: string; trackEventIndex?: boolean } = {},
) {
  let messageId: string | undefined;
  const pendingUpdates = new Map<string, Message>();
  let updateTimer: NodeJS.Timeout | undefined;
  let eventIndex = opts.trackEventIndex ? getStoredEventIndex() : 0;

  const scheduleUpdate = () => {
    if (updateTimer) clearTimeout(updateTimer);
    updateTimer = setTimeout(() => {
      if (pendingUpdates.size > 0) {
        useStore.getState().updateMessages(Array.from(pendingUpdates.values()));
        pendingUpdates.clear();
      }
    }, 16); // ~60fps
  };

  try {
    for await (const event of stream) {
      const { type, data } = event;
      let message: Message | undefined;

      if (opts.trackEventIndex) {
        eventIndex++;
        setStoredEventIndex(eventIndex);
      }

      if (type === "error") {
        if (data.reason !== "cancelled") {
          toast(data.error || "An error occurred while generating the response.");
        }
        break;
      }
      if (type === "citations") {
        const ongoingResearchId = useStore.getState().ongoingResearchId;
        if (ongoingResearchId && data.citations) {
          useStore.getState().setCitations(ongoingResearchId, data.citations);
        }
        continue;
      }

      if (type === "tool_call_result") {
        message = findMessageByToolCallId(data.tool_call_id);
        if (message) {
          messageId = message.id;
        } else {
          if (process.env.NODE_ENV === "development") {
            console.warn(`Tool call result without matching message: ${data.tool_call_id}`);
          }
          continue;
        }
      } else {
        messageId = data.id;

        if (!existsMessage(messageId)) {
          message = {
            id: messageId,
            threadId: data.thread_id,
            agent: data.agent,
            role: data.role,
            content: "",
            contentChunks: [],
            reasoningContent: "",
            reasoningContentChunks: [],
            isStreaming: true,
            interruptFeedback: opts.interruptFeedback,
          };
          appendMessage(message);
        }
      }

      message ??= getMessage(messageId);
      if (message) {
        message = mergeMessage(message, event);
        pendingUpdates.set(message.id, message);
        scheduleUpdate();
      }
    }
  } catch (error) {
    const isAborted = (error as Error).name === "AbortError";
    if (!isAborted) {
      toast("An error occurred while generating the response. Please try again.");
    }
    if (messageId != null) {
      const message = getMessage(messageId);
      if (message?.isStreaming) {
        message.isStreaming = false;
        useStore.getState().updateMessage(message);
      }
    }
    useStore.getState().setOngoingResearch(null);
  } finally {
    if (updateTimer) clearTimeout(updateTimer);
    if (pendingUpdates.size > 0) {
      useStore.getState().updateMessages(Array.from(pendingUpdates.values()));
    }
  }
}

export async function sendMessage(
  content?: string,
  {
    interruptFeedback,
    resources,
  }: {
    interruptFeedback?: string;
    resources?: Array<Resource>;
  } = {},
  options: { abortSignal?: AbortSignal } = {},
) {
  if (content != null) {
    appendMessage({
      id: nanoid(),
      threadId: THREAD_ID,
      role: "user",
      content: content,
      contentChunks: [content],
      resources,
    });
  }

  // Check if there's already a running workflow we should reconnect to
  try {
    const status = await fetchWorkflowStatus(THREAD_ID);
    if (status.status === "running") {
      setResponding(true);
      // If store is empty (e.g. page was refreshed), replay from 0;
      // otherwise resume from where we left off.
      const hasMessages = useStore.getState().messageIds.length > 0;
      const fromIndex = hasMessages ? getStoredEventIndex() : 0;
      if (!hasMessages) setStoredEventIndex(0);
      const reconnectStream = chatStreamReconnect(THREAD_ID, fromIndex, options);
      await processEventStream(reconnectStream, {
        interruptFeedback,
        trackEventIndex: true,
      });
      setResponding(false);
      return;
    }
  } catch {
    // Status check failed, proceed with new stream
  }

  const settings = getChatStreamSettings();
  const stream = chatStream(
    content ?? "[REPLAY]",
    {
      thread_id: THREAD_ID,
      interrupt_feedback: interruptFeedback,
      resources,
      auto_accepted_plan: settings.autoAcceptedPlan,
      enable_clarification: settings.enableClarification ?? false,
      max_clarification_rounds: settings.maxClarificationRounds ?? 3,
      enable_deep_thinking: settings.enableDeepThinking ?? false,
      enable_background_investigation:
        settings.enableBackgroundInvestigation ?? true,
      enable_web_search: settings.enableWebSearch ?? true,
      max_plan_iterations: settings.maxPlanIterations,
      max_step_num: settings.maxStepNum,
      max_search_results: settings.maxSearchResults,
      report_style: settings.reportStyle,
      mcp_settings: settings.mcpSettings,
    },
    options,
  );

  // Reset event index for new workflow
  setStoredEventIndex(0);
  setResponding(true);
  await processEventStream(stream, {
    interruptFeedback,
    trackEventIndex: true,
  });
  setResponding(false);
  // Refresh conversation list after message completes
  loadConversations();
}

function setResponding(value: boolean) {
  useStore.setState({ responding: value });
}

function existsMessage(id: string) {
  return useStore.getState().messageIds.includes(id);
}

function getMessage(id: string) {
  return useStore.getState().messages.get(id);
}

function findMessageByToolCallId(toolCallId: string) {
  return Array.from(useStore.getState().messages.values())
    .reverse()
    .find((message) => {
      if (message.toolCalls) {
        return message.toolCalls.some((toolCall) => toolCall.id === toolCallId);
      }
      return false;
    });
}

function appendMessage(message: Message) {
  if (
    message.agent === "coder" ||
    message.agent === "reporter" ||
    message.agent === "researcher" ||
    message.agent === "analyst"
  ) {
    if (!getOngoingResearchId()) {
      const id = message.id;
      appendResearch(id);
      openResearch(id);
    }
    appendResearchActivity(message);
  }
  useStore.getState().appendMessage(message);
}

function updateMessage(message: Message) {
  if (
    getOngoingResearchId() &&
    message.agent === "reporter" &&
    !message.isStreaming
  ) {
    useStore.getState().setOngoingResearch(null);
  }
  useStore.getState().updateMessage(message);
}

function getOngoingResearchId() {
  return useStore.getState().ongoingResearchId;
}

function appendResearch(researchId: string) {
  let planMessage: Message | undefined;
  let userQuery: string | undefined;
  const reversedMessageIds = [...useStore.getState().messageIds].reverse();
  for (const messageId of reversedMessageIds) {
    const message = getMessage(messageId);
    if (!planMessage && message?.agent === "planner") {
      planMessage = message;
    }
    if (!userQuery && message?.role === "user") {
      userQuery = message.content;
    }
    if (planMessage && userQuery) {
      break;
    }
  }
  const messageIds = [researchId];
  messageIds.unshift(planMessage!.id);
  useStore.setState({
    ongoingResearchId: researchId,
    researchIds: [...useStore.getState().researchIds, researchId],
    researchPlanIds: new Map(useStore.getState().researchPlanIds).set(
      researchId,
      planMessage!.id,
    ),
    researchActivityIds: new Map(useStore.getState().researchActivityIds).set(
      researchId,
      messageIds,
    ),
    researchQueries: new Map(useStore.getState().researchQueries).set(
      researchId,
      userQuery ?? "",
    ),
  });
}

function appendResearchActivity(message: Message) {
  const researchId = getOngoingResearchId();
  if (researchId) {
    const researchActivityIds = useStore.getState().researchActivityIds;
    const current = researchActivityIds.get(researchId)!;
    if (!current.includes(message.id)) {
      useStore.setState({
        researchActivityIds: new Map(researchActivityIds).set(researchId, [
          ...current,
          message.id,
        ]),
      });
    }
    if (message.agent === "reporter") {
      useStore.setState({
        researchReportIds: new Map(useStore.getState().researchReportIds).set(
          researchId,
          message.id,
        ),
      });
    }
  }
}

export function openResearch(researchId: string | null) {
  useStore.getState().openResearch(researchId);
}

export function closeResearch() {
  useStore.getState().closeResearch();
}

export async function listenToPodcast(researchId: string) {
  const planMessageId = useStore.getState().researchPlanIds.get(researchId);
  const reportMessageId = useStore.getState().researchReportIds.get(researchId);
  if (planMessageId && reportMessageId) {
    const planMessage = getMessage(planMessageId)!;
    const title = parseJSON(planMessage.content, { title: "Untitled" }).title;
    const reportMessage = getMessage(reportMessageId);
    if (reportMessage?.content) {
      appendMessage({
        id: nanoid(),
        threadId: THREAD_ID,
        role: "user",
        content: "Please generate a podcast for the above research.",
        contentChunks: [],
      });
      const podCastMessageId = nanoid();
      const podcastObject = { title, researchId };
      const podcastMessage: Message = {
        id: podCastMessageId,
        threadId: THREAD_ID,
        role: "assistant",
        agent: "podcast",
        content: JSON.stringify(podcastObject),
        contentChunks: [],
        reasoningContent: "",
        reasoningContentChunks: [],
        isStreaming: true,
      };
      appendMessage(podcastMessage);
      // Generating podcast...
      let audioUrl: string | undefined;
      try {
        audioUrl = await generatePodcast(reportMessage.content);
      } catch (e) {
        console.error(e);
        useStore.setState((state) => ({
          messages: new Map(useStore.getState().messages).set(
            podCastMessageId,
            {
              ...state.messages.get(podCastMessageId)!,
              content: JSON.stringify({
                ...podcastObject,
                error: e instanceof Error ? e.message : "Unknown error",
              }),
              isStreaming: false,
            },
          ),
        }));
        toast("An error occurred while generating podcast. Please try again.");
        return;
      }
      useStore.setState((state) => ({
        messages: new Map(useStore.getState().messages).set(podCastMessageId, {
          ...state.messages.get(podCastMessageId)!,
          content: JSON.stringify({ ...podcastObject, audioUrl }),
          isStreaming: false,
        }),
      }));
    }
  }
}

export function useResearchMessage(researchId: string) {
  return useStore(
    useShallow((state) => {
      const messageId = state.researchPlanIds.get(researchId);
      return messageId ? state.messages.get(messageId) : undefined;
    }),
  );
}

export function getResearchQuery(researchId: string): string {
  return useStore.getState().researchQueries.get(researchId) ?? "";
}

export function useMessage(messageId: string | null | undefined) {
  return useStore(
    useShallow((state) =>
      messageId ? state.messages.get(messageId) : undefined,
    ),
  );
}

export function useMessageIds() {
  return useStore(useShallow((state) => state.messageIds));
}

export function useRenderableMessageIds() {
  return useStore(
    useShallow((state) => {
      // Filter to only messages that will actually render in MessageListView
      // This prevents duplicate keys and React warnings when messages change state
      return state.messageIds.filter((messageId) => {
        const message = state.messages.get(messageId);
        if (!message) return false;

        // Only include messages that match MessageListItem rendering conditions
        // These are the same conditions checked in MessageListItem component
        const isPlanner = message.agent === "planner";
        const isPodcast = message.agent === "podcast";
        const isStartOfResearch = state.researchIds.includes(messageId);

        // Planner, podcast, and research cards always render (they have their own content)
        if (isPlanner || isPodcast || isStartOfResearch) {
          return true;
        }

        // For user and coordinator messages, only include if they have content
        // This prevents empty dividers from appearing in the UI
        if (message.role === "user" || message.agent === "coordinator") {
          return !!message.content;
        }

        return false;
      });
    }),
  );
}

export function useLastInterruptMessage() {
  return useStore(
    useShallow((state) => {
      if (state.messageIds.length >= 2) {
        const lastMessage = state.messages.get(
          state.messageIds[state.messageIds.length - 1]!,
        );
        return lastMessage?.finishReason === "interrupt" ? lastMessage : null;
      }
      return null;
    }),
  );
}

export function useLastFeedbackMessageId() {
  const waitingForFeedbackMessageId = useStore(
    useShallow((state) => {
      if (state.messageIds.length >= 2) {
        const lastMessage = state.messages.get(
          state.messageIds[state.messageIds.length - 1]!,
        );
        if (lastMessage && lastMessage.finishReason === "interrupt") {
          return state.messageIds[state.messageIds.length - 2];
        }
      }
      return null;
    }),
  );
  return waitingForFeedbackMessageId;
}

export function useToolCalls() {
  return useStore(
    useShallow((state) => {
      return state.messageIds
        ?.map((id) => getMessage(id)?.toolCalls)
        .filter((toolCalls) => toolCalls != null)
        .flat();
    }),
  );
}

export function useCitations(researchId: string | null | undefined) {
  return useStore(
    useShallow((state) =>
      researchId ? state.researchCitations.get(researchId) ?? [] : []
    ),
  );
}

export function getCitations(researchId: string): Citation[] {
  return useStore.getState().researchCitations.get(researchId) ?? [];
}

/**
 * Restore a previous session. First checks if a workflow is still running
 * on the backend (e.g. user refreshed mid-research). If so, reconnects to
 * the live SSE stream. Otherwise falls back to replaying persisted history.
 *
 * Returns true if a session was restored, false otherwise.
 */
export async function restoreSession(): Promise<boolean> {
  // Nothing to restore if no persisted thread_id
  if (typeof window === "undefined") return false;
  let storedId: string | null = null;
  try {
    storedId = localStorage.getItem(THREAD_ID_STORAGE_KEY);
  } catch {
    return false;
  }
  if (!storedId) return false;

  // 1. Check if the backend still has a running workflow for this thread
  try {
    const status = await fetchWorkflowStatus(storedId);
    if (status.status === "running") {
      // Page was refreshed — store is empty, so replay ALL events from index 0
      // to rebuild the full message state, then continue streaming live events.
      setResponding(true);
      setStoredEventIndex(0);
      const reconnectStream = chatStreamReconnect(storedId, 0);
      await processEventStream(reconnectStream, { trackEventIndex: true });
      setResponding(false);
      return useStore.getState().messageIds.length > 0;
    }
    if (status.status === "completed" || status.status === "error") {
      // Workflow finished but events are still in memory — replay them all.
      // This is faster than waiting for the history endpoint (which depends
      // on checkpoint persistence).
      setStoredEventIndex(0);
      const replayStream = chatStreamReconnect(storedId, 0);
      await processEventStream(replayStream, { trackEventIndex: true });
      if (useStore.getState().messageIds.length > 0) {
        return true;
      }
      // If replay yielded nothing (e.g. run was cleaned up), fall through
      // to the history endpoint below.
    }
  } catch {
    // Status check failed — fall through to history restore
  }

  // 2. Workflow not running — restore from persisted history
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      resolveServiceURL(`chat/history/${encodeURIComponent(storedId)}`),
      { signal: controller.signal, credentials: "include" },
    );
    clearTimeout(timeoutId);

    if (!res.ok) return false;

    const data = (await res.json()) as {
      thread_id: string;
      messages: string[];
      available: boolean;
    };

    if (!data.available || !data.messages || data.messages.length === 0) {
      return false;
    }

    // Replay each SSE event string through the same merge logic used during
    // live streaming. The format is "event: {type}\ndata: {json}\n\n".
    for (const raw of data.messages) {
      try {
        const normalized = raw.replace(/\r\n/g, "\n").trim();
        const lines = normalized.split("\n");
        if (lines.length < 2) continue;

        const eventLine = lines[0]!;
        const dataLine = lines.slice(1).join("\n");

        const eventType = eventLine.replace(/^event:\s*/, "");
        const jsonStr = dataLine.replace(/^data:\s*/, "");

        const eventData = JSON.parse(jsonStr);
        const chatEvent = { type: eventType, data: eventData } as ChatEvent;

        // Skip error events during restoration
        if (chatEvent.type === "error") continue;

        // Handle citations
        if (chatEvent.type === "citations") {
          const ongoingResearchId = useStore.getState().ongoingResearchId;
          if (ongoingResearchId && chatEvent.data.citations) {
            useStore
              .getState()
              .setCitations(ongoingResearchId, chatEvent.data.citations);
          }
          continue;
        }

        // Handle tool_call_result: find the message that owns this tool call
        let messageId: string | undefined;
        if (chatEvent.type === "tool_call_result") {
          const ownerMessage = findMessageByToolCallId(
            chatEvent.data.tool_call_id,
          );
          if (ownerMessage) {
            messageId = ownerMessage.id;
          } else {
            continue;
          }
        } else {
          messageId = chatEvent.data.id;
          if (!existsMessage(messageId)) {
            const msg: Message = {
              id: messageId,
              threadId: chatEvent.data.thread_id,
              agent: chatEvent.data.agent,
              role: chatEvent.data.role,
              content: "",
              contentChunks: [],
              reasoningContent: "",
              reasoningContentChunks: [],
              isStreaming: false,
            };
            appendMessage(msg);
          }
        }

        let message = getMessage(messageId!);
        if (message) {
          message = mergeMessage(message, chatEvent);
          message.isStreaming = false;
          useStore.getState().updateMessage(message);
        }
      } catch {
        // Skip malformed events
      }
    }

    return useStore.getState().messageIds.length > 0;
  } catch {
    // Network error or timeout — degrade gracefully
    return false;
  }
}

/**
 * Reset the current session: generate a new thread_id, clear localStorage,
 * and reload the page to start fresh.
 */
export function resetSession() {
  startNewConversation();
}

/**
 * Load conversations from the backend for the current user.
 */
export async function loadConversations() {
  try {
    const { conversations } = await fetchConversations();
    useStore.setState({ conversations, conversationsLoaded: true });
  } catch {
    // Network error — leave state as-is
  }
}

/**
 * Switch to an existing conversation by thread_id.
 * Resets message state but preserves the conversations list.
 */
export function switchConversation(threadId: string) {
  THREAD_ID = threadId;
  try {
    localStorage.setItem(THREAD_ID_STORAGE_KEY, threadId);
    localStorage.removeItem(EVENT_INDEX_STORAGE_KEY);
  } catch {
    // ignore
  }
  // Reset message state, keep conversations list
  useStore.setState({
    threadId: threadId,
    responding: false,
    messageIds: [],
    messages: new Map(),
    researchIds: [],
    researchPlanIds: new Map(),
    researchReportIds: new Map(),
    researchActivityIds: new Map(),
    researchQueries: new Map(),
    researchCitations: new Map(),
    ongoingResearchId: null,
    openResearchId: null,
  });
}

/**
 * Start a brand new conversation with a fresh thread_id.
 */
export function startNewConversation() {
  const newId = nanoid();
  switchConversation(newId);
}
