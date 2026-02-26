"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfigFormField } from "@/components/admin/config-form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  useSummarizationConfig,
  useUpdateSummarizationConfig,
} from "@/core/admin";
import type { SummarizationConfig } from "@/core/admin";

export default function SummarizationPage() {
  const { data, isLoading } = useSummarizationConfig();
  const mutation = useUpdateSummarizationConfig();
  const [form, setForm] = useState<SummarizationConfig>({});

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const handleSave = useCallback(() => {
    mutation.mutate(form, {
      onSuccess: () => toast.success("Summarization config saved"),
      onError: (e) => toast.error(e.message),
    });
  }, [form, mutation]);

  if (isLoading)
    return <div className="text-muted-foreground">Loading...</div>;

  // Normalize trigger to array
  const triggers = Array.isArray(form.trigger)
    ? form.trigger
    : form.trigger
      ? [form.trigger]
      : [];

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Summarization</h1>
      <Card className="space-y-5 p-6">
        <ConfigFormField label="Enabled">
          <Switch
            checked={form.enabled ?? true}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
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

        <div className="space-y-3">
          <h2 className="text-sm font-medium">Triggers</h2>
          {triggers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                className="w-32"
                value={t.type}
                placeholder="type"
                onChange={(e) => {
                  const next = [...triggers];
                  next[i] = { type: e.target.value, value: t.value };
                  setForm({ ...form, trigger: next });
                }}
              />
              <Input
                className="w-32"
                type="number"
                value={t.value}
                placeholder="value"
                onChange={(e) => {
                  const next = [...triggers];
                  next[i] = { type: t.type, value: Number(e.target.value) };
                  setForm({ ...form, trigger: next });
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setForm({ ...form, trigger: triggers.filter((_, j) => j !== i) });
                }}
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setForm({
                ...form,
                trigger: [...triggers, { type: "tokens", value: 15564 }],
              })
            }
          >
            Add Trigger
          </Button>
        </div>

        <ConfigFormField label="Keep Policy">
          <div className="flex items-center gap-2">
            <Input
              className="w-32"
              value={form.keep?.type ?? "messages"}
              placeholder="type"
              onChange={(e) =>
                setForm({
                  ...form,
                  keep: { type: e.target.value, value: form.keep?.value ?? 10 },
                })
              }
            />
            <Input
              className="w-32"
              type="number"
              value={form.keep?.value ?? 10}
              placeholder="value"
              onChange={(e) =>
                setForm({
                  ...form,
                  keep: {
                    type: form.keep?.type ?? "messages",
                    value: Number(e.target.value),
                  },
                })
              }
            />
          </div>
        </ConfigFormField>

        <ConfigFormField label="Trim Tokens to Summarize">
          <Input
            type="number"
            value={form.trim_tokens_to_summarize ?? ""}
            placeholder="null"
            onChange={(e) =>
              setForm({
                ...form,
                trim_tokens_to_summarize: e.target.value
                  ? Number(e.target.value)
                  : null,
              })
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
