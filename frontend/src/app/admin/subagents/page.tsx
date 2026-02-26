"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfigFormField } from "@/components/admin/config-form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useSubagentsConfig, useUpdateSubagentsConfig } from "@/core/admin";
import type { SubagentsConfig } from "@/core/admin";

export default function SubagentsPage() {
  const { data, isLoading } = useSubagentsConfig();
  const mutation = useUpdateSubagentsConfig();
  const [form, setForm] = useState<SubagentsConfig>({});

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const handleSave = useCallback(() => {
    mutation.mutate(form, {
      onSuccess: () => toast.success("Subagents config saved"),
      onError: (e) => toast.error(e.message),
    });
  }, [form, mutation]);

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;

  const agents = form.agents ?? {};

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Subagents</h1>
      <Card className="space-y-5 p-6">
        <ConfigFormField
          label="Default Timeout (seconds)"
          description="Global timeout for all subagents"
        >
          <Input
            type="number"
            value={form.timeout_seconds ?? 900}
            onChange={(e) =>
              setForm({ ...form, timeout_seconds: Number(e.target.value) })
            }
          />
        </ConfigFormField>

        <h2 className="pt-2 text-sm font-medium">Per-Agent Overrides</h2>

        {["general-purpose", "bash"].map((name) => (
          <ConfigFormField
            key={name}
            label={`${name} timeout (seconds)`}
            description="Leave empty to use default"
          >
            <Input
              type="number"
              placeholder="(use default)"
              value={agents[name]?.timeout_seconds ?? ""}
              onChange={(e) => {
                const val = e.target.value;
                const next = { ...agents };
                if (val === "") {
                  delete next[name];
                } else {
                  next[name] = { timeout_seconds: Number(val) };
                }
                setForm({ ...form, agents: next });
              }}
            />
          </ConfigFormField>
        ))}

        <Button onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Save"}
        </Button>
      </Card>
    </div>
  );
}
