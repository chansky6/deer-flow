"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfigFormField } from "@/components/admin/config-form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useMemoryAdminConfig, useUpdateMemoryConfig } from "@/core/admin";
import type { MemoryConfig } from "@/core/admin";

export default function MemoryPage() {
  const { data, isLoading } = useMemoryAdminConfig();
  const mutation = useUpdateMemoryConfig();
  const [form, setForm] = useState<MemoryConfig>({});

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const handleSave = useCallback(() => {
    mutation.mutate(form, {
      onSuccess: () => toast.success("Memory config saved"),
      onError: (e) => toast.error(e.message),
    });
  }, [form, mutation]);

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Memory</h1>
      <Card className="space-y-5 p-6">
        <ConfigFormField label="Enabled" description="Enable memory mechanism">
          <Switch
            checked={form.enabled ?? true}
            onCheckedChange={(v) => setForm({ ...form, enabled: v })}
          />
        </ConfigFormField>

        <ConfigFormField label="Storage Path">
          <Input
            value={form.storage_path ?? ""}
            onChange={(e) => setForm({ ...form, storage_path: e.target.value })}
          />
        </ConfigFormField>

        <ConfigFormField label="Debounce Seconds">
          <Input
            type="number"
            value={form.debounce_seconds ?? 30}
            onChange={(e) =>
              setForm({ ...form, debounce_seconds: Number(e.target.value) })
            }
          />
        </ConfigFormField>

        <ConfigFormField label="Model Name" description="null = use default model">
          <Input
            value={form.model_name ?? ""}
            placeholder="null (default model)"
            onChange={(e) =>
              setForm({ ...form, model_name: e.target.value || null })
            }
          />
        </ConfigFormField>

        <ConfigFormField label="Max Facts">
          <Input
            type="number"
            value={form.max_facts ?? 100}
            onChange={(e) =>
              setForm({ ...form, max_facts: Number(e.target.value) })
            }
          />
        </ConfigFormField>

        <ConfigFormField label="Fact Confidence Threshold">
          <Input
            type="number"
            step="0.1"
            value={form.fact_confidence_threshold ?? 0.7}
            onChange={(e) =>
              setForm({
                ...form,
                fact_confidence_threshold: Number(e.target.value),
              })
            }
          />
        </ConfigFormField>

        <ConfigFormField label="Injection Enabled">
          <Switch
            checked={form.injection_enabled ?? true}
            onCheckedChange={(v) =>
              setForm({ ...form, injection_enabled: v })
            }
          />
        </ConfigFormField>

        <ConfigFormField label="Max Injection Tokens">
          <Input
            type="number"
            value={form.max_injection_tokens ?? 2000}
            onChange={(e) =>
              setForm({
                ...form,
                max_injection_tokens: Number(e.target.value),
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
