// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

"use client";

import {
  DeleteOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Tooltip } from "~/components/deer-flow/tooltip";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { deleteConversation } from "~/core/api/chat";
import {
  loadConversations,
  restoreSession,
  startNewConversation,
  switchConversation,
  useStore,
} from "~/core/store";
import { cn } from "~/lib/utils";

export function ConversationSidebar() {
  const t = useTranslations("chat.sidebar");
  const conversations = useStore((state) => state.conversations);
  const conversationsLoaded = useStore((state) => state.conversationsLoaded);
  const currentThreadId = useStore((state) => state.threadId);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (!conversationsLoaded) {
      loadConversations();
    }
  }, [conversationsLoaded]);

  const handleSwitch = useCallback(
    async (threadId: string) => {
      if (threadId === currentThreadId) return;
      switchConversation(threadId);
      await restoreSession();
    },
    [currentThreadId],
  );

  const handleNew = useCallback(() => {
    startNewConversation();
  }, []);

  const handleDelete = useCallback(
    async (e: React.MouseEvent, threadId: string) => {
      e.stopPropagation();
      const ok = await deleteConversation(threadId);
      if (!ok) return;
      useStore.setState((state) => ({
        conversations: state.conversations.filter(
          (c) => c.thread_id !== threadId,
        ),
      }));
      if (threadId === currentThreadId) {
        startNewConversation();
      }
    },
    [currentThreadId],
  );

  // Collapsed state: just a narrow strip with toggle + new button
  if (collapsed) {
    return (
      <div className="border-r flex h-full w-10 shrink-0 flex-col items-center py-3 gap-2">
        <Tooltip title={t("expand")} side="right">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setCollapsed(false)}
          >
            <MenuUnfoldOutlined className="text-xs" />
          </Button>
        </Tooltip>
        <Tooltip title={t("newConversation")} side="right">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleNew}
          >
            <PlusOutlined className="text-xs" />
          </Button>
        </Tooltip>
      </div>
    );
  }

  return (
    <div className="border-r flex h-full w-60 shrink-0 flex-col">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-sm font-medium">{t("title")}</span>
        <div className="flex items-center gap-0.5">
          <Tooltip title={t("newConversation")}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={handleNew}
            >
              <PlusOutlined className="text-xs" />
            </Button>
          </Tooltip>
          <Tooltip title={t("collapse")}>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setCollapsed(true)}
            >
              <MenuFoldOutlined className="text-xs" />
            </Button>
          </Tooltip>
        </div>
      </div>
      <ScrollArea className="flex-1 overflow-hidden">
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {conversations.length === 0 && conversationsLoaded && (
            <p className="text-muted-foreground px-2 py-4 text-center text-xs">
              {t("noConversations")}
            </p>
          )}
          {conversations.map((conv) => (
            <ConversationItem
              key={conv.thread_id}
              title={conv.title}
              threadId={conv.thread_id}
              active={conv.thread_id === currentThreadId}
              onSwitch={handleSwitch}
              onDelete={handleDelete}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

/**
 * Single conversation row. Shows a tooltip with the full title
 * only when the text is actually truncated (overflowing).
 */
function ConversationItem({
  title,
  threadId,
  active,
  onSwitch,
  onDelete,
}: {
  title: string;
  threadId: string;
  active: boolean;
  onSwitch: (id: string) => void;
  onDelete: (e: React.MouseEvent, id: string) => void;
}) {
  const titleRef = useRef<HTMLSpanElement>(null);
  const [isTruncated, setIsTruncated] = useState(false);

  // Detect whether the text is actually overflowing
  useEffect(() => {
    const el = titleRef.current;
    if (el) {
      setIsTruncated(el.scrollWidth > el.clientWidth);
    }
  }, [title]);

  const inner = (
    <button
      onClick={() => onSwitch(threadId)}
      className={cn(
        "group relative flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm transition-colors",
        "hover:bg-accent",
        active && "bg-accent font-medium",
      )}
    >
      <span ref={titleRef} className="truncate pr-6">
        {title}
      </span>
      <span
        role="button"
        tabIndex={0}
        className="absolute right-1 hidden group-hover:inline-flex"
        onClick={(e) => onDelete(e, threadId)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            onDelete(e as unknown as React.MouseEvent, threadId);
          }
        }}
      >
        <DeleteOutlined className="text-muted-foreground hover:text-destructive text-xs" />
      </span>
    </button>
  );

  if (isTruncated) {
    return (
      <Tooltip title={title} side="right" delayDuration={400}>
        {inner}
      </Tooltip>
    );
  }

  return inner;
}
