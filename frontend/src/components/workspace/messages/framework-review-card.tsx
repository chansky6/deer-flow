"use client";

import { Code2Icon, EyeIcon, LoaderCircleIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
      : props.review.review_title || t.frameworkReview.title;
  const description =
    props.mode === "confirmed"
      ? t.frameworkReview.confirmedDescription
      : props.review.instructions || t.frameworkReview.defaultInstructions;
  const trimmedMarkdown = markdown.trim();
  const isDirty =
    props.mode === "pending" ? markdown !== props.review.draft_markdown : false;
  const rawReadonly = props.mode !== "pending";

  return (
    <Card className="bg-background/90 w-full gap-4 border shadow-sm">
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
          <div className="min-h-[240px] rounded-lg border p-4">
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
        ) : (
          <div className="h-[420px] overflow-hidden rounded-lg border">
            <CodeEditor
              className={cn("size-full rounded-none border-none")}
              value={currentMarkdown}
              onChange={props.mode === "pending" ? setMarkdown : undefined}
              readonly={rawReadonly}
              disabled={props.mode === "pending" ? props.isConfirming : true}
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
            {t.frameworkReview.helperText}
          </p>
        )}
      </CardContent>
      {props.mode === "pending" && (
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
