"use client";

import { LanguagesIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

type LanguageToggleButtonProps = {
  className?: string;
};

export function LanguageToggleButton({ className }: LanguageToggleButtonProps) {
  const { locale, changeLocale, t } = useI18n();

  const currentLocaleLabel = locale === "zh-CN" ? "中文" : "English";

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn("h-8 gap-2", className)}
      aria-label={t.settings.appearance.languageTitle}
      onClick={() => changeLocale(locale === "zh-CN" ? "en-US" : "zh-CN")}
    >
      <LanguagesIcon className="size-4" />
      <span className="hidden sm:inline">{currentLocaleLabel}</span>
    </Button>
  );
}
