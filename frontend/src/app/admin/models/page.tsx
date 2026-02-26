"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfigFormField } from "@/components/admin/config-form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useModelsConfig, useUpdateModelsConfig } from "@/core/admin";
import type { ModelConfig } from "@/core/admin";

const EMPTY_MODEL: ModelConfig = {
  name: "",
  use: "langchain_openai:ChatOpenAI",
  model: "",
};

function formatFieldValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

export default function ModelsPage() {
  const { data, isLoading } = useModelsConfig();
  const mutation = useUpdateModelsConfig();
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  useEffect(() => {
    if (data) setModels(data);
  }, [data]);

  const handleSave = useCallback(() => {
    mutation.mutate(models, {
      onSuccess: () => toast.success("Models config saved"),
      onError: (e) => toast.error(e.message),
    });
  }, [models, mutation]);

  const addModel = useCallback(() => {
    setModels((prev) => [...prev, { ...EMPTY_MODEL }]);
    setEditIdx(models.length);
  }, [models.length]);

  const removeModel = useCallback((idx: number) => {
    setModels((prev) => prev.filter((_, i) => i !== idx));
    setEditIdx(null);
  }, []);

  if (isLoading)
    return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Models</h1>
        <Button size="sm" onClick={addModel}>
          <Plus className="mr-1 h-4 w-4" />
          Add Model
        </Button>
      </div>

      {models.map((m, idx) => (
        <Card key={idx} className="p-4">
          {editIdx === idx ? (
            <ModelEditForm
              model={m}
              onChange={(updated) => {
                const next = [...models];
                next[idx] = updated;
                setModels(next);
              }}
              onClose={() => setEditIdx(null)}
              onRemove={() => removeModel(idx)}
            />
          ) : (
            <div
              className="flex cursor-pointer items-center justify-between"
              onClick={() => setEditIdx(idx)}
            >
              <div>
                <span className="font-medium">{m.name || "(unnamed)"}</span>
                {m.display_name && (
                  <span className="ml-2 text-sm text-muted-foreground">
                    {m.display_name}
                  </span>
                )}
              </div>
              <span className="text-xs text-muted-foreground">{m.use}</span>
            </div>
          )}
        </Card>
      ))}

      <Button onClick={handleSave} disabled={mutation.isPending}>
        {mutation.isPending ? "Saving..." : "Save All"}
      </Button>
    </div>
  );
}

// Fields that have dedicated UI controls — everything else is rendered as dynamic key-value pairs
const KNOWN_FIELDS = new Set([
  "name",
  "display_name",
  "description",
  "use",
  "model",
  "supports_vision",
  "supports_thinking",
  "when_thinking_enabled",
]);

function ModelEditForm({
  model,
  onChange,
  onClose,
  onRemove,
}: {
  model: ModelConfig;
  onChange: (m: ModelConfig) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  const [newKey, setNewKey] = useState("");

  const set = (key: string, value: unknown) =>
    onChange({ ...model, [key]: value });

  const removeField = (key: string) => {
    const next = { ...model };
    delete next[key];
    onChange(next);
  };

  // Collect extra fields (api_key, api_base, base_url, max_tokens, temperature, etc.)
  const extraFields = Object.keys(model).filter(
    (k) => !KNOWN_FIELDS.has(k) && model[k] !== undefined,
  );

  const addField = () => {
    const key = newKey.trim();
    if (!key || key in model) return;
    set(key, "");
    setNewKey("");
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <ConfigFormField label="Name">
          <Input value={model.name} onChange={(e) => set("name", e.target.value)} />
        </ConfigFormField>
        <ConfigFormField label="Display Name">
          <Input
            value={model.display_name ?? ""}
            onChange={(e) => set("display_name", e.target.value)}
          />
        </ConfigFormField>
      </div>

      <ConfigFormField label="Use (class path)">
        <Input value={model.use} onChange={(e) => set("use", e.target.value)} />
      </ConfigFormField>

      <ConfigFormField label="Model ID">
        <Input
          value={model.model ?? ""}
          onChange={(e) => set("model", e.target.value)}
        />
      </ConfigFormField>

      <div className="flex items-center gap-6">
        <ConfigFormField label="Vision">
          <Switch
            checked={model.supports_vision ?? false}
            onCheckedChange={(v) => set("supports_vision", v)}
          />
        </ConfigFormField>
        <ConfigFormField label="Thinking">
          <Switch
            checked={model.supports_thinking ?? false}
            onCheckedChange={(v) => set("supports_thinking", v)}
          />
        </ConfigFormField>
      </div>

      {extraFields.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Extra Fields</h3>
          {extraFields.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className="w-36 shrink-0 text-sm text-muted-foreground">
                {key}
              </span>
              <Input
                className="flex-1"
                value={formatFieldValue(model[key])}
                placeholder={key === "api_key" ? "$ENV_VAR" : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  // Auto-convert to number if the value looks numeric
                  set(key, v !== "" && !isNaN(Number(v)) && !/^\$/.test(v) ? Number(v) : v);
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeField(key)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Input
          className="w-40"
          placeholder="New field name"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addField()}
        />
        <Button variant="outline" size="sm" onClick={addField}>
          <Plus className="mr-1 h-3 w-3" />
          Add Field
        </Button>
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button variant="outline" size="sm" onClick={onClose}>
          Done
        </Button>
        <Button variant="destructive" size="sm" onClick={onRemove}>
          <Trash2 className="mr-1 h-3 w-3" />
          Remove
        </Button>
      </div>
    </div>
  );
}
