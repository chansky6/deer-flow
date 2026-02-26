"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfigFormField } from "@/components/admin/config-form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useSandboxConfig, useUpdateSandboxConfig } from "@/core/admin";
import type { SandboxConfig } from "@/core/admin";

export default function SandboxPage() {
  const { data, isLoading } = useSandboxConfig();
  const mutation = useUpdateSandboxConfig();
  const [form, setForm] = useState<SandboxConfig>({ use: "" });

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const handleSave = useCallback(() => {
    mutation.mutate(form, {
      onSuccess: () => toast.success("Sandbox config saved"),
      onError: (e) => toast.error(e.message),
    });
  }, [form, mutation]);

  if (isLoading) return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Sandbox</h1>
      <Card className="space-y-5 p-6">
        <ConfigFormField
          label="Provider (use)"
          description="Class path of the sandbox provider"
        >
          <Input
            value={form.use}
            onChange={(e) => setForm({ ...form, use: e.target.value })}
          />
        </ConfigFormField>

        <ConfigFormField label="Image" description="Docker image for sandbox container">
          <Input
            value={form.image ?? ""}
            placeholder="(default)"
            onChange={(e) => setForm({ ...form, image: e.target.value || undefined })}
          />
        </ConfigFormField>

        <ConfigFormField label="Port">
          <Input
            type="number"
            value={form.port ?? ""}
            placeholder="8080"
            onChange={(e) =>
              setForm({ ...form, port: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </ConfigFormField>

        <ConfigFormField label="Base URL" description="Use existing sandbox at this URL">
          <Input
            value={form.base_url ?? ""}
            placeholder="(start new container)"
            onChange={(e) => setForm({ ...form, base_url: e.target.value || undefined })}
          />
        </ConfigFormField>

        <ConfigFormField label="Auto Start">
          <Switch
            checked={form.auto_start ?? true}
            onCheckedChange={(v) => setForm({ ...form, auto_start: v })}
          />
        </ConfigFormField>

        <ConfigFormField label="Container Prefix">
          <Input
            value={form.container_prefix ?? ""}
            placeholder="deer-flow-sandbox"
            onChange={(e) =>
              setForm({ ...form, container_prefix: e.target.value || undefined })
            }
          />
        </ConfigFormField>

        <ConfigFormField label="Idle Timeout (seconds)">
          <Input
            type="number"
            value={form.idle_timeout ?? ""}
            placeholder="600"
            onChange={(e) =>
              setForm({ ...form, idle_timeout: e.target.value ? Number(e.target.value) : undefined })
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
