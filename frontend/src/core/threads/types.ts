import type { Message, Thread } from "@langchain/langgraph-sdk";

import type { Todo } from "../todos";

export interface FrameworkReviewState {
  tool_call_id: string;
  kind: "consulting_analysis";
  status: "pending";
  review_title: string;
  instructions: string;
  draft_markdown: string;
}

export interface StreamingFrameworkReviewMeta {
  kind: "consulting_analysis";
  status: "streaming";
  review_title: string;
  instructions: string;
}

export interface StreamingFrameworkReviewState
  extends StreamingFrameworkReviewMeta {
  draft_markdown: string;
}

export interface FrameworkReviewDraftStartedEvent {
  type: "framework_review_draft_started";
  kind: StreamingFrameworkReviewMeta["kind"];
  review_title: string;
  instructions: string;
}

export interface ConfirmedAnalysisFrameworkState {
  tool_call_id: string;
  markdown: string;
}

export interface AgentThreadState extends Record<string, unknown> {
  title: string;
  messages: Message[];
  artifacts: string[];
  todos?: Todo[];
  framework_review?: FrameworkReviewState | null;
  confirmed_analysis_framework?: ConfirmedAnalysisFrameworkState | null;
}

export interface AgentThread extends Thread<AgentThreadState> {}

export interface AgentThreadContext extends Record<string, unknown> {
  thread_id: string;
  model_name: string | undefined;
  thinking_enabled: boolean;
  is_plan_mode: boolean;
  subagent_enabled: boolean;
  reasoning_effort?: "minimal" | "low" | "medium" | "high";
  agent_name?: string;
}
