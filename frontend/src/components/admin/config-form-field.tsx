"use client";

import { cn } from "@/lib/utils";

interface ConfigFormFieldProps {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}

export function ConfigFormField({
  label,
  description,
  children,
  className,
}: ConfigFormFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label className="text-sm font-medium">{label}</label>
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
      {children}
    </div>
  );
}
