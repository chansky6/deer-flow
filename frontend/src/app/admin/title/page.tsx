"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfigFormField } from "@/components/admin/config-form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useTitleConfig, useUpdateTitleConfig } from "@/core/admin";
import type { TitleConfig } from "@/core/admin";

export default function TitlePage() {
  const { data, isLoading } = useTitleConfig();
  const mutation = useUpdateTitleConfig();
  const [form, setForm] = useState<TitleConfig>({});

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const handleSave = useCallback(() => {
    mutation.mutate(form, {
      onSuccess: () => toast.success("Title config saved"),
      onError: (e) => toast.error(e.message),
    });
  }, [form, mutation]);

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Title Generation</h1>
      <Card className="space-y-5 p-6">
        <ConfigFormField
          label="Enabled"
          description="Enable automatic title generation"
        >
          <Switch
            checked={form.enabled ?? true}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          />
        </ConfigFormField>

        <ConfigFormField label="Max Words">
          <Input
            type="number"
            value={form.max_words ?? 6}
            onChange={(e) =>
              setForm({ ...form, max_words: Number(e.target.value) })
            }
          />
        </ConfigFormField>

        <ConfigFormField label="Max Characters">
          <Input
            type="number"
            value={form.max_chars ?? 60}
            onChange={(e) =>
              setForm({ ...form, max_chars: Number(e.target.value) })
            }
          />
        </ConfigFormField>

        <ConfigFormField
          label="Model Name"
          description="null = use default model"
        >
          <Input
            value={form.model_name ?? ""}
            placeholder="null (default model)"
            onChange={(e) =>
              setForm({ ...form, model_name: e.target.value || null })
            }
          />
        </ConfigFormField>

        <Button onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Save"}
        </Button>
      </Card>
    </div>
  );
}
