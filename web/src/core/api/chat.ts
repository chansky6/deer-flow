// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { env } from "~/env";

import type { MCPServerMetadata } from "../mcp";
import type { Resource } from "../messages";
import { extractReplayIdFromSearchParams } from "../replay/get-replay-id";
import { fetchStream } from "../sse";
import { sleep } from "../utils";

import { resolveServiceURL } from "./resolve-service-url";
import type { ChatEvent } from "./types";

function getLocaleFromCookie(): string {
  if (typeof document === "undefined") return "en-US";
  
  // Map frontend locale codes to backend locale format
  // Frontend uses: "en", "zh"
  // Backend expects: "en-US", "zh-CN"
  const LOCALE_MAP = { "en": "en-US", "zh": "zh-CN" } as const;
  
  // Initialize to raw locale format (matches cookie format)
  let rawLocale = "en";
  
  // Read from cookie
  const cookies = document.cookie.split(";");
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split("=");
    if (name === "NEXT_LOCALE" && value) {
      rawLocale = decodeURIComponent(value);
      break;
    }
  }
  
  // Map raw locale to backend format, fallback to en-US if unmapped
  return LOCALE_MAP[rawLocale as keyof typeof LOCALE_MAP] ?? "en-US";
}

export async function* chatStream(
  userMessage: string,
  params: {
    thread_id: string;
    resources?: Array<Resource>;
    auto_accepted_plan: boolean;
    enable_clarification?: boolean;
    max_clarification_rounds?: number;
    max_plan_iterations: number;
    max_step_num: number;
    max_search_results?: number;
    interrupt_feedback?: string;
    enable_deep_thinking?: boolean;
    enable_background_investigation: boolean;
    enable_web_search?: boolean;
    report_style?: "academic" | "popular_science" | "news" | "social_media" | "strategic_investment";
    mcp_settings?: {
      servers: Record<
        string,
        MCPServerMetadata & {
          enabled_tools: string[];
          add_to_agents: string[];
        }
      >;
    };
  },
  options: { abortSignal?: AbortSignal } = {},
) {
  if (
    env.NEXT_PUBLIC_STATIC_WEBSITE_ONLY ||
    location.search.includes("mock") ||
    location.search.includes("replay=")
  ) 
    return yield* chatReplayStream(userMessage, params, options);
  
  try{
    const locale = getLocaleFromCookie();
    const stream = fetchStream(resolveServiceURL("chat/stream"), {
      body: JSON.stringify({
        messages: [{ role: "user", content: userMessage }],
        locale,
        ...params,
      }),
      signal: options.abortSignal,
    });
    
    for await (const event of stream) {
      if (event.data == null) continue;
      yield {
        type: event.event,
        data: JSON.parse(event.data),
      } as ChatEvent;
    }
  }catch(e){
    console.error(e);
  }
}

async function* chatReplayStream(
  userMessage: string,
  params: {
    thread_id: string;
    auto_accepted_plan: boolean;
    max_plan_iterations: number;
    max_step_num: number;
    max_search_results?: number;
    interrupt_feedback?: string;
  } = {
    thread_id: "__mock__",
    auto_accepted_plan: false,
    max_plan_iterations: 3,
    max_step_num: 1,
    max_search_results: 3,
    interrupt_feedback: undefined,
  },
  options: { abortSignal?: AbortSignal } = {},
): AsyncIterable<ChatEvent> {
  const urlParams = new URLSearchParams(window.location.search);
  let replayFilePath = "";
  if (urlParams.has("mock")) {
    if (urlParams.get("mock")) {
      replayFilePath = `/mock/${urlParams.get("mock")!}.txt`;
    } else {
      if (params.interrupt_feedback === "accepted") {
        replayFilePath = "/mock/final-answer.txt";
      } else if (params.interrupt_feedback === "edit_plan") {
        replayFilePath = "/mock/re-plan.txt";
      } else {
        replayFilePath = "/mock/first-plan.txt";
      }
    }
    fastForwardReplaying = true;
  } else {
    const replayId = extractReplayIdFromSearchParams(window.location.search);
    if (replayId) {
      replayFilePath = `/replay/${replayId}.txt`;
    } else {
      // Fallback to a default replay
      replayFilePath = `/replay/eiffel-tower-vs-tallest-building.txt`;
    }
  }
  const text = await fetchReplay(replayFilePath, {
    abortSignal: options.abortSignal,
  });
  const normalizedText = text.replace(/\r\n/g, "\n");
  const chunks = normalizedText.split("\n\n");
  for (const chunk of chunks) {
    const [eventRaw, dataRaw] = chunk.split("\n") as [string, string];
    const [, event] = eventRaw.split("event: ", 2) as [string, string];
    const [, data] = dataRaw.split("data: ", 2) as [string, string];

    try {
      const chatEvent = {
        type: event,
        data: JSON.parse(data),
      } as ChatEvent;
      if (chatEvent.type === "message_chunk") {
        if (!chatEvent.data.finish_reason) {
          await sleepInReplay(50);
        }
      } else if (chatEvent.type === "tool_call_result") {
        await sleepInReplay(500);
      }
      yield chatEvent;
      if (chatEvent.type === "tool_call_result") {
        await sleepInReplay(800);
      } else if (chatEvent.type === "message_chunk") {
        if (chatEvent.data.role === "user") {
          await sleepInReplay(500);
        }
      }
    } catch (e) {
      console.error(e);
    }
  }
}

const replayCache = new Map<string, string>();
export async function fetchReplay(
  url: string,
  options: { abortSignal?: AbortSignal } = {},
) {
  if (replayCache.has(url)) {
    return replayCache.get(url)!;
  }
  const res = await fetch(url, {
    signal: options.abortSignal,
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch replay: ${res.statusText}`);
  }
  const text = await res.text();
  replayCache.set(url, text);
  return text;
}

export async function fetchReplayTitle() {
  const res = chatReplayStream(
    "",
    {
      thread_id: "__mock__",
      auto_accepted_plan: false,
      max_plan_iterations: 3,
      max_step_num: 1,
      max_search_results: 3,
    },
    {},
  );
  for await (const event of res) {
    if (event.type === "message_chunk") {
      return event.data.content;
    }
  }
}

export async function sleepInReplay(ms: number) {
  if (fastForwardReplaying) {
    await sleep(0);
  } else {
    await sleep(ms);
  }
}

let fastForwardReplaying = false;
export function fastForwardReplay(value: boolean) {
  fastForwardReplaying = value;
}

// --- Workflow status & reconnection APIs ---

export interface WorkflowStatus {
  thread_id: string;
  status: "running" | "completed" | "error" | "not_found";
  event_count: number;
}

export async function fetchWorkflowStatus(
  threadId: string,
): Promise<WorkflowStatus> {
  const res = await fetch(
    resolveServiceURL(`chat/status/${encodeURIComponent(threadId)}`),
    { method: "GET", credentials: "include" },
  );
  if (!res.ok) {
    return { thread_id: threadId, status: "not_found", event_count: 0 };
  }
  return (await res.json()) as WorkflowStatus;
}

export async function* chatStreamReconnect(
  threadId: string,
  lastEventIndex: number,
  options: { abortSignal?: AbortSignal } = {},
): AsyncIterable<ChatEvent> {
  const url = resolveServiceURL(
    `chat/stream/${encodeURIComponent(threadId)}?last_event_index=${lastEventIndex}`,
  );
  const response = await fetch(url, {
    method: "GET",
    headers: { "Cache-Control": "no-cache" },
    credentials: "include",
    signal: options.abortSignal,
  });
  if (!response.ok || !response.body) {
    return;
  }

  const reader = response.body
    .pipeThrough(new TextDecoderStream())
    .getReader();

  try {
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        if (buffer.trim()) {
          const event = parseSSEEvent(buffer.trim());
          if (event) yield event;
        }
        break;
      }
      buffer += value;
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (chunk.trim()) {
          const event = parseSSEEvent(chunk.trim());
          if (event) yield event;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSSEEvent(chunk: string): ChatEvent | undefined {
  let eventType = "message";
  let data: string | null = null;
  for (const line of chunk.split("\n")) {
    const pos = line.indexOf(": ");
    if (pos === -1) continue;
    const key = line.slice(0, pos);
    const value = line.slice(pos + 2);
    if (key === "event") eventType = value;
    else if (key === "data") data = value;
  }
  if (!data) return undefined;
  try {
    return { type: eventType, data: JSON.parse(data) } as ChatEvent;
  } catch {
    return undefined;
  }
}

// --- Conversation CRUD APIs ---

export interface Conversation {
  id: string;
  thread_id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export async function fetchConversations(
  limit = 50,
  offset = 0,
): Promise<{ conversations: Conversation[] }> {
  const res = await fetch(
    resolveServiceURL(`conversations?limit=${limit}&offset=${offset}`),
    { method: "GET", credentials: "include" },
  );
  if (!res.ok) return { conversations: [] };
  return (await res.json()) as { conversations: Conversation[] };
}

export async function deleteConversation(threadId: string): Promise<boolean> {
  const res = await fetch(
    resolveServiceURL(`conversations/${encodeURIComponent(threadId)}`),
    { method: "DELETE", credentials: "include" },
  );
  return res.ok;
}

export async function updateConversationTitle(
  threadId: string,
  title: string,
): Promise<boolean> {
  const res = await fetch(
    resolveServiceURL(`conversations/${encodeURIComponent(threadId)}`),
    {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    },
  );
  return res.ok;
}
