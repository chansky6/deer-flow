"use client";

import { ChevronDownIcon, ChevronUpIcon, Code2Icon, EyeIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useI18n } from "@/core/i18n/hooks";
import type {
  FrameworkReviewState,
  StreamingFrameworkReviewState,
} from "@/core/threads";
import { cn } from "@/lib/utils";

import { CodeEditor } from "../code-editor";

import { MarkdownContent, type MarkdownContentProps } from "./markdown-content";

type FrameworkReviewViewMode = "preview" | "raw";

type StreamingFrameworkReviewCardProps = {
  mode: "streaming";
  review: StreamingFrameworkReviewState;
  rehypePlugins: MarkdownContentProps["rehypePlugins"];
};

type PendingFrameworkReviewCardProps = {
  mode: "pending";
  review: FrameworkReviewState;
  rehypePlugins: MarkdownContentProps["rehypePlugins"];
  isConfirming?: boolean;
  isLocked?: boolean;
  onConfirm: (markdown: string) => Promise<void>;
};

type ConfirmedFrameworkReviewCardProps = {
  mode: "confirmed";
  markdown: string;
  rehypePlugins: MarkdownContentProps["rehypePlugins"];
};

export function FrameworkReviewCard(
  props:
    | StreamingFrameworkReviewCardProps
    | PendingFrameworkReviewCardProps
    | ConfirmedFrameworkReviewCardProps,
) {
  const { t } = useI18n();
  const [viewMode, setViewMode] = useState<FrameworkReviewViewMode>("preview");
  const sourceMarkdown = useMemo(() => {
    if (props.mode === "confirmed") {
      return props.markdown;
    }

    return props.review.draft_markdown;
  }, [props]);
  const [markdown, setMarkdown] = useState(sourceMarkdown);

  useEffect(() => {
    setMarkdown(sourceMarkdown);
  }, [sourceMarkdown]);

  const currentMarkdown = props.mode === "pending" ? markdown : sourceMarkdown;
  const title =
    props.mode === "confirmed"
      ? t.frameworkReview.confirmedTitle
      : props.review.review_title ?? t.frameworkReview.title;
  const description =
    props.mode === "confirmed"
      ? t.frameworkReview.confirmedDescription
      : props.review.instructions ?? t.frameworkReview.defaultInstructions;
  const trimmedMarkdown = markdown.trim();
  const isEditablePending = props.mode === "pending" && !props.isLocked;
  const isDirty = isEditablePending
    ? markdown !== props.review.draft_markdown
    : false;
  const rawReadonly = props.mode !== "pending" || props.isLocked;
  const previewContainerRef = useRef<HTMLDivElement | null>(null);
  const [collapsedMaxHeight, setCollapsedMaxHeight] = useState(0);
  const [isCollapsible, setIsCollapsible] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const updateCollapsedMaxHeight = () => {
      const nextHeight = Math.max(Math.min(window.innerHeight - 240, 880), 360);
      setCollapsedMaxHeight((previousHeight) =>
        previousHeight === nextHeight ? previousHeight : nextHeight,
      );
    };

    updateCollapsedMaxHeight();
    window.addEventListener("resize", updateCollapsedMaxHeight);
    return () => {
      window.removeEventListener("resize", updateCollapsedMaxHeight);
    };
  }, []);

  useEffect(() => {
    const previewContainer = previewContainerRef.current;
    if (!previewContainer || viewMode !== "preview" || collapsedMaxHeight === 0) {
      return;
    }

    const updateCollapsible = () => {
      const nextIsCollapsible =
        previewContainer.scrollHeight > collapsedMaxHeight + 8;
      setIsCollapsible((previousValue) =>
        previousValue === nextIsCollapsible ? previousValue : nextIsCollapsible,
      );
      if (!nextIsCollapsible) {
        setIsExpanded(false);
      }
    };

    updateCollapsible();

    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      updateCollapsible();
    });
    resizeObserver.observe(previewContainer);
    return () => {
      resizeObserver.disconnect();
    };
  }, [collapsedMaxHeight, currentMarkdown, viewMode]);

  return (
    <Card className="bg-muted/35 border-border/70 w-full gap-4 border shadow-sm backdrop-blur-sm">
      <CardHeader className="gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start">
            {props.mode === "streaming" && (
              <div className="text-muted-foreground flex items-center gap-1 text-xs">
                <LoaderCircleIcon className="size-3 animate-spin" />
                <span>{t.frameworkReview.streamingStatus}</span>
              </div>
            )}
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={viewMode}
              onValueChange={(value) => {
                if (value) {
                  setViewMode(value as FrameworkReviewViewMode);
                }
              }}
            >
              <ToggleGroupItem value="preview">
                <EyeIcon />
                <span>{t.common.preview}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="raw">
                <Code2Icon />
                <span>{t.frameworkReview.rawMarkdown}</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {viewMode === "preview" ? (
          <div className="space-y-3">
            <div
              ref={previewContainerRef}
              className={cn(
                "bg-background/70 min-h-[240px] rounded-lg border border-border/70 p-4 transition-[max-height] duration-300",
                !isExpanded && isCollapsible && "overflow-hidden",
              )}
              style={
                !isExpanded && isCollapsible && collapsedMaxHeight > 0
                  ? { maxHeight: `${collapsedMaxHeight}px` }
                  : undefined
              }
            >
              {currentMarkdown ? (
                <MarkdownContent
                  content={currentMarkdown}
                  isLoading={props.mode === "streaming"}
                  rehypePlugins={props.rehypePlugins}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  {t.frameworkReview.streamingEmptyState}
                </p>
              )}
            </div>
            {isCollapsible && (
              <div className="relative">
                {!isExpanded && (
                  <div className="from-muted/95 pointer-events-none absolute inset-x-0 -top-20 h-20 bg-gradient-to-t to-transparent" />
                )}
                <div className="relative z-10 flex justify-center">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="bg-background/90 shadow-sm"
                    onClick={() => setIsExpanded((previousValue) => !previousValue)}
                  >
                    {isExpanded ? <ChevronUpIcon /> : <ChevronDownIcon />}
                    {isExpanded
                      ? t.frameworkReview.collapse
                      : t.frameworkReview.expand}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="bg-background/70 h-[420px] overflow-hidden rounded-lg border border-border/70">
            <CodeEditor
              className={cn("size-full rounded-none border-none")}
              value={currentMarkdown}
              onChange={isEditablePending ? setMarkdown : undefined}
              readonly={rawReadonly}
              disabled={props.mode === "pending" ? Boolean(props.isConfirming) || Boolean(props.isLocked) : true}
              settings={{ lineNumbers: true, foldGutter: true }}
            />
          </div>
        )}
        {props.mode === "streaming" && (
          <p className="text-muted-foreground text-xs">
            {t.frameworkReview.streamingDescription}
          </p>
        )}
        {props.mode === "pending" && (
          <p className="text-muted-foreground text-xs">
            {props.isLocked
              ? t.frameworkReview.lockedHelperText
              : t.frameworkReview.helperText}
          </p>
        )}
      </CardContent>
      {props.mode === "pending" && !props.isLocked && (
        <CardFooter className="flex items-center justify-between gap-3">
          <Button
            variant="ghost"
            onClick={() => setMarkdown(props.review.draft_markdown)}
            disabled={!isDirty || props.isConfirming}
          >
            {t.frameworkReview.restoreDraft}
          </Button>
          <Button
            onClick={() => void props.onConfirm(trimmedMarkdown)}
            disabled={!trimmedMarkdown || props.isConfirming}
          >
            {props.isConfirming
              ? t.frameworkReview.confirming
              : t.frameworkReview.confirmAndContinue}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
