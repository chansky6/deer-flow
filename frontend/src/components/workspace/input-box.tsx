"use client";

import type { ChatStatus } from "ai";
import {
  CheckIcon,
  CompassIcon,
  GraduationCapIcon,
  ImageIcon,
  LightbulbIcon,
  MicroscopeIcon,
  PaperclipIcon,
  PenLineIcon,
  RocketIcon,
  ShapesIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  VideoIcon,
  XIcon,
  ZapIcon,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
} from "react";

import {
  PromptInput,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuItem,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
  usePromptInputController,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import {
  DropdownMenuGroup,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/core/i18n/hooks";
import { useModels } from "@/core/models/hooks";
import type { AgentThreadContext } from "@/core/threads";
import { cn } from "@/lib/utils";

import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorName,
  ModelSelectorTrigger,
} from "../ai-elements/model-selector";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";

import { ModeHoverGuide } from "./mode-hover-guide";
import { Tooltip } from "./tooltip";

type InputMode = "flash" | "thinking" | "pro" | "ultra";
type ToolSelection = {
  taskType: string;
  toolName: string;
  label: string;
  icon: LucideIcon;
  prompt?: string;
  args: Record<string, unknown>;
};

function getResolvedMode(
  mode: InputMode | undefined,
  supportsThinking: boolean,
): InputMode {
  if (!supportsThinking && mode !== "flash") {
    return "flash";
  }
  if (mode) {
    return mode;
  }
  return supportsThinking ? "pro" : "flash";
}

export function InputBox({
  className,
  disabled,
  autoFocus,
  status = "ready",
  context,
  extraHeader,
  isNewThread,
  initialValue,
  onContextChange,
  onSubmit,
  onStop,
  ...props
}: Omit<ComponentProps<typeof PromptInput>, "onSubmit"> & {
  assistantId?: string | null;
  status?: ChatStatus;
  disabled?: boolean;
  context: Omit<
    AgentThreadContext,
    "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
  > & {
    mode: "flash" | "thinking" | "pro" | "ultra" | undefined;
  };
  extraHeader?: React.ReactNode;
  isNewThread?: boolean;
  initialValue?: string;
  onContextChange?: (
    context: Partial<
      Omit<
        AgentThreadContext,
        "thread_id" | "is_plan_mode" | "thinking_enabled" | "subagent_enabled"
      > & {
        mode: "flash" | "thinking" | "pro" | "ultra" | undefined;
      }
    >,
  ) => void;
  onSubmit?: (
    message: PromptInputMessage,
    toolSelection?: {
      task_type: string;
      tool_name: string;
      tool_args: Record<string, unknown>;
    },
  ) => void;
  onStop?: () => void;
}) {
  const { t } = useI18n();
  const { textInput } = usePromptInputController();
  const [modelDialogOpen, setModelDialogOpen] = useState(false);
  const { models } = useModels();

  const toolOptions = useMemo(() => {
    const [writeSuggestion, researchSuggestion, collectSuggestion, learnSuggestion] =
      t.inputBox.suggestions;
    const [webpageRaw, imageRaw, videoRaw, , skillRaw] =
      t.inputBox.suggestionsCreate;
    const webpageOption =
      webpageRaw && "type" in webpageRaw ? undefined : webpageRaw;
    const imageOption =
      imageRaw && "type" in imageRaw ? undefined : imageRaw;
    const videoOption =
      videoRaw && "type" in videoRaw ? undefined : videoRaw;
    const skillOption =
      skillRaw && "type" in skillRaw ? undefined : skillRaw;

    return [
      {
        taskType: "deep_research",
        toolName: "deep_research",
        label: researchSuggestion?.suggestion ?? "Deep Research",
        icon: MicroscopeIcon,
        prompt: researchSuggestion?.prompt,
        args: { depth: "high", min_sources: 6 },
      },
      {
        taskType: "content_writing",
        toolName: "write",
        label: writeSuggestion?.suggestion ?? "Write",
        icon: PenLineIcon,
        prompt: writeSuggestion?.prompt,
        args: { style: "article" },
      },
      {
        taskType: "data_collection",
        toolName: "collect",
        label: collectSuggestion?.suggestion ?? "Collect",
        icon: ShapesIcon,
        prompt: collectSuggestion?.prompt,
        args: { output: "report" },
      },
      {
        taskType: "learning_tutorial",
        toolName: "learn",
        label: learnSuggestion?.suggestion ?? "Learn",
        icon: GraduationCapIcon,
        prompt: learnSuggestion?.prompt,
        args: { format: "tutorial" },
      },
      {
        taskType: "webpage_generation",
        toolName: "webpage",
        label: webpageOption?.suggestion ?? "Webpage",
        icon: CompassIcon,
        prompt: webpageOption?.prompt,
        args: { artifact: "html" },
      },
      {
        taskType: "image_generation",
        toolName: "image",
        label: imageOption?.suggestion ?? "Image",
        icon: ImageIcon,
        prompt: imageOption?.prompt,
        args: { artifact: "image" },
      },
      {
        taskType: "video_generation",
        toolName: "video",
        label: videoOption?.suggestion ?? "Video",
        icon: VideoIcon,
        prompt: videoOption?.prompt,
        args: { artifact: "video" },
      },
      {
        taskType: "skill_creation",
        toolName: "skill",
        label: skillOption?.suggestion ?? "Skill",
        icon: SparklesIcon,
        prompt: skillOption?.prompt,
        args: { mode: "skill_creator" },
      },
    ] satisfies ToolSelection[];
  }, [t.inputBox.suggestions, t.inputBox.suggestionsCreate]);

  const contextTaskType =
    typeof context.task_type === "string" ? context.task_type : undefined;
  const contextToolName =
    typeof context.tool_name === "string" ? context.tool_name : undefined;
  const contextToolArgs =
    context.tool_args && typeof context.tool_args === "object"
      ? (context.tool_args as Record<string, unknown>)
      : undefined;

  const selectedTool = useMemo(() => {
    if (!contextTaskType || !contextToolName) {
      return null;
    }
    const option = toolOptions.find(
      (tool) =>
        tool.taskType === contextTaskType && tool.toolName === contextToolName,
    );
    if (!option) {
      return null;
    }
    return {
      ...option,
      args: contextToolArgs ?? option.args,
    };
  }, [contextTaskType, contextToolArgs, contextToolName, toolOptions]);

  const applyPromptTemplate = useCallback(
    (prompt: string | undefined) => {
      if (!prompt) {
        return;
      }
      if (textInput.value.trim()) {
        return;
      }
      textInput.setInput(prompt);
      setTimeout(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(
          "textarea[name='message']",
        );
        if (!textarea) {
          return;
        }
        const selStart = prompt.indexOf("[");
        const selEnd = prompt.indexOf("]");
        if (selStart !== -1 && selEnd !== -1) {
          textarea.setSelectionRange(selStart, selEnd + 1);
          textarea.focus();
        }
      }, 300);
    },
    [textInput],
  );

  const handleToolSelect = useCallback(
    (tool: ToolSelection) => {
      onContextChange?.({
        task_type: tool.taskType,
        tool_name: tool.toolName,
        tool_args: tool.args,
      });
      applyPromptTemplate(tool.prompt);
    },
    [applyPromptTemplate, onContextChange],
  );

  useEffect(() => {
    if (models.length === 0) {
      return;
    }
    const currentModel = models.find((m) => m.name === context.model_name);
    const fallbackModel = currentModel ?? models[0]!;
    const supportsThinking = fallbackModel.supports_thinking ?? false;
    const nextModelName = fallbackModel.name;
    const nextMode = getResolvedMode(context.mode, supportsThinking);

    if (context.model_name === nextModelName && context.mode === nextMode) {
      return;
    }

    onContextChange?.({
      model_name: nextModelName,
      mode: nextMode,
    });
  }, [context, models, onContextChange]);

  const selectedModel = useMemo(() => {
    if (models.length === 0) {
      return undefined;
    }
    return models.find((m) => m.name === context.model_name) ?? models[0];
  }, [context.model_name, models]);

  const supportThinking = useMemo(
    () => selectedModel?.supports_thinking ?? false,
    [selectedModel],
  );

  const handleModelSelect = useCallback(
    (model_name: string) => {
      const model = models.find((m) => m.name === model_name);
      if (!model) {
        return;
      }
      onContextChange?.({
        model_name,
        mode: getResolvedMode(context.mode, model.supports_thinking ?? false),
      });
      setModelDialogOpen(false);
    },
    [onContextChange, context, models],
  );

  const handleModeSelect = useCallback(
    (mode: InputMode) => {
      onContextChange?.({
        mode: getResolvedMode(mode, supportThinking),
      });
    },
    [onContextChange, supportThinking],
  );
  const handleSubmit = useCallback(
    async (message: PromptInputMessage) => {
      if (status === "streaming") {
        onStop?.();
        return;
      }
      if (!message.text) {
        return;
      }
      onSubmit?.(
        message,
        selectedTool
          ? {
              task_type: selectedTool.taskType,
              tool_name: selectedTool.toolName,
              tool_args: selectedTool.args,
            }
          : undefined,
      );
    },
    [onSubmit, onStop, selectedTool, status],
  );
  return (
    <PromptInput
      className={cn(
        "bg-background/85 rounded-2xl backdrop-blur-sm transition-all duration-300 ease-out *:data-[slot='input-group']:rounded-2xl",
        className,
      )}
      disabled={disabled}
      globalDrop
      multiple
      onSubmit={handleSubmit}
      {...props}
    >
      {extraHeader && (
        <div className="absolute top-0 right-0 left-0 z-10">
          <div className="absolute right-0 bottom-0 left-0 flex items-center justify-center">
            {extraHeader}
          </div>
        </div>
      )}
      <PromptInputAttachments>
        {(attachment) => <PromptInputAttachment data={attachment} />}
      </PromptInputAttachments>
      <PromptInputBody className="absolute top-0 right-0 left-0 z-3">
        <PromptInputTextarea
          className={cn("size-full")}
          disabled={disabled}
          placeholder={t.inputBox.placeholder}
          autoFocus={autoFocus}
          defaultValue={initialValue}
        />
      </PromptInputBody>
      <PromptInputFooter className="flex">
        <PromptInputTools>
          {/* TODO: Add more connectors here
          <PromptInputActionMenu>
            <PromptInputActionMenuTrigger className="px-2!" />
            <PromptInputActionMenuContent>
              <PromptInputActionAddAttachments
                label={t.inputBox.addAttachments}
              />
            </PromptInputActionMenuContent>
          </PromptInputActionMenu> */}
          <AddAttachmentsButton className="px-2!" />
          <ToolSelector
            label={t.settings.sections.tools}
            disabled={disabled}
            options={toolOptions}
            selectedTool={selectedTool}
            onSelect={handleToolSelect}
            onClear={() =>
              onContextChange?.({
                task_type: undefined,
                tool_name: undefined,
                tool_args: undefined,
              })
            }
          />
          <PromptInputActionMenu>
            <ModeHoverGuide
              mode={
                context.mode === "flash" ||
                context.mode === "thinking" ||
                context.mode === "pro" ||
                context.mode === "ultra"
                  ? context.mode
                  : "flash"
              }
            >
              <PromptInputActionMenuTrigger className="gap-1! px-2!">
                <div>
                  {context.mode === "flash" && <ZapIcon className="size-3" />}
                  {context.mode === "thinking" && (
                    <LightbulbIcon className="size-3" />
                  )}
                  {context.mode === "pro" && (
                    <GraduationCapIcon className="size-3" />
                  )}
                  {context.mode === "ultra" && (
                    <RocketIcon className="size-3 text-[#dabb5e]" />
                  )}
                </div>
                <div
                  className={cn(
                    "text-xs font-normal",
                    context.mode === "ultra" ? "golden-text" : "",
                  )}
                >
                  {(context.mode === "flash" && t.inputBox.flashMode) ||
                    (context.mode === "thinking" && t.inputBox.reasoningMode) ||
                    (context.mode === "pro" && t.inputBox.proMode) ||
                    (context.mode === "ultra" && t.inputBox.ultraMode)}
                </div>
              </PromptInputActionMenuTrigger>
            </ModeHoverGuide>
            <PromptInputActionMenuContent className="w-80">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-muted-foreground text-xs">
                  {t.inputBox.mode}
                </DropdownMenuLabel>
                <PromptInputActionMenu>
                  <PromptInputActionMenuItem
                    className={cn(
                      context.mode === "flash"
                        ? "text-accent-foreground"
                        : "text-muted-foreground/65",
                    )}
                    onSelect={() => handleModeSelect("flash")}
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1 font-bold">
                        <ZapIcon
                          className={cn(
                            "mr-2 size-4",
                            context.mode === "flash" &&
                              "text-accent-foreground",
                          )}
                        />
                        {t.inputBox.flashMode}
                      </div>
                      <div className="pl-7 text-xs">
                        {t.inputBox.flashModeDescription}
                      </div>
                    </div>
                    {context.mode === "flash" ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </PromptInputActionMenuItem>
                  {supportThinking && (
                    <PromptInputActionMenuItem
                      className={cn(
                        context.mode === "thinking"
                          ? "text-accent-foreground"
                          : "text-muted-foreground/65",
                      )}
                      onSelect={() => handleModeSelect("thinking")}
                    >
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center gap-1 font-bold">
                          <LightbulbIcon
                            className={cn(
                              "mr-2 size-4",
                              context.mode === "thinking" &&
                                "text-accent-foreground",
                            )}
                          />
                          {t.inputBox.reasoningMode}
                        </div>
                        <div className="pl-7 text-xs">
                          {t.inputBox.reasoningModeDescription}
                        </div>
                      </div>
                      {context.mode === "thinking" ? (
                        <CheckIcon className="ml-auto size-4" />
                      ) : (
                        <div className="ml-auto size-4" />
                      )}
                    </PromptInputActionMenuItem>
                  )}
                  <PromptInputActionMenuItem
                    className={cn(
                      context.mode === "pro"
                        ? "text-accent-foreground"
                        : "text-muted-foreground/65",
                    )}
                    onSelect={() => handleModeSelect("pro")}
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1 font-bold">
                        <GraduationCapIcon
                          className={cn(
                            "mr-2 size-4",
                            context.mode === "pro" && "text-accent-foreground",
                          )}
                        />
                        {t.inputBox.proMode}
                      </div>
                      <div className="pl-7 text-xs">
                        {t.inputBox.proModeDescription}
                      </div>
                    </div>
                    {context.mode === "pro" ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </PromptInputActionMenuItem>
                  <PromptInputActionMenuItem
                    className={cn(
                      context.mode === "ultra"
                        ? "text-accent-foreground"
                        : "text-muted-foreground/65",
                    )}
                    onSelect={() => handleModeSelect("ultra")}
                  >
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-1 font-bold">
                        <RocketIcon
                          className={cn(
                            "mr-2 size-4",
                            context.mode === "ultra" && "text-[#dabb5e]",
                          )}
                        />
                        <div
                          className={cn(
                            context.mode === "ultra" && "golden-text",
                          )}
                        >
                          {t.inputBox.ultraMode}
                        </div>
                      </div>
                      <div className="pl-7 text-xs">
                        {t.inputBox.ultraModeDescription}
                      </div>
                    </div>
                    {context.mode === "ultra" ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </PromptInputActionMenuItem>
                </PromptInputActionMenu>
              </DropdownMenuGroup>
            </PromptInputActionMenuContent>
          </PromptInputActionMenu>
        </PromptInputTools>
        <PromptInputTools>
          <ModelSelector
            open={modelDialogOpen}
            onOpenChange={setModelDialogOpen}
          >
            <ModelSelectorTrigger asChild>
              <PromptInputButton>
                <ModelSelectorName className="text-xs font-normal">
                  {selectedModel?.display_name}
                </ModelSelectorName>
              </PromptInputButton>
            </ModelSelectorTrigger>
            <ModelSelectorContent>
              <ModelSelectorInput placeholder={t.inputBox.searchModels} />
              <ModelSelectorList>
                {models.map((m) => (
                  <ModelSelectorItem
                    key={m.name}
                    value={m.name}
                    onSelect={() => handleModelSelect(m.name)}
                  >
                    <ModelSelectorName>{m.display_name}</ModelSelectorName>
                    {m.name === context.model_name ? (
                      <CheckIcon className="ml-auto size-4" />
                    ) : (
                      <div className="ml-auto size-4" />
                    )}
                  </ModelSelectorItem>
                ))}
              </ModelSelectorList>
            </ModelSelectorContent>
          </ModelSelector>
          <PromptInputSubmit
            className="rounded-full"
            disabled={disabled}
            variant="outline"
            status={status}
          />
        </PromptInputTools>
      </PromptInputFooter>
      {!isNewThread && (
        <div className="bg-background absolute right-0 -bottom-[17px] left-0 z-0 h-4"></div>
      )}
    </PromptInput>
  );
}

function ToolSelector({
  label,
  disabled,
  options,
  selectedTool,
  onSelect,
  onClear,
}: {
  label: string;
  disabled?: boolean;
  options: ToolSelection[];
  selectedTool: ToolSelection | null;
  onSelect: (tool: ToolSelection) => void;
  onClear: () => void;
}) {
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <PromptInputButton disabled={disabled} className="px-2!">
            <SlidersHorizontalIcon className="size-3" />
            <span className="text-xs font-normal">{label}</span>
          </PromptInputButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuLabel className="text-muted-foreground text-xs">
            {label}
          </DropdownMenuLabel>
          <DropdownMenuGroup>
            {options.map((tool) => (
              <DropdownMenuItem key={tool.taskType} onClick={() => onSelect(tool)}>
                <tool.icon className="size-4" />
                {tool.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {selectedTool && (
        <div className="bg-primary/8 text-primary inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs">
          <selectedTool.icon className="size-3.5" />
          <span>{selectedTool.label}</span>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center justify-center rounded-full"
            onClick={onClear}
            aria-label="Clear selected tool"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      )}
    </>
  );
}

function AddAttachmentsButton({ className }: { className?: string }) {
  const { t } = useI18n();
  const attachments = usePromptInputAttachments();
  return (
    <Tooltip content={t.inputBox.addAttachments}>
      <PromptInputButton
        className={cn("px-2!", className)}
        onClick={() => attachments.openFileDialog()}
      >
        <PaperclipIcon className="size-3" />
      </PromptInputButton>
    </Tooltip>
  );
}
