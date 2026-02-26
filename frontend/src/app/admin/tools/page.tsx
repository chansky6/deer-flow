"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ConfigFormField } from "@/components/admin/config-form-field";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  useToolsConfig,
  useUpdateToolsConfig,
  useToolGroupsConfig,
  useUpdateToolGroupsConfig,
} from "@/core/admin";
import type { ToolConfig, ToolGroupConfig } from "@/core/admin";

export default function ToolsPage() {
  const { data: toolsData, isLoading: toolsLoading } = useToolsConfig();
  const { data: groupsData, isLoading: groupsLoading } = useToolGroupsConfig();
  const toolsMutation = useUpdateToolsConfig();
  const groupsMutation = useUpdateToolGroupsConfig();

  const [tools, setTools] = useState<ToolConfig[]>([]);
  const [groups, setGroups] = useState<ToolGroupConfig[]>([]);
  const [editIdx, setEditIdx] = useState<number | null>(null);

  useEffect(() => {
    if (toolsData) setTools(toolsData);
  }, [toolsData]);

  useEffect(() => {
    if (groupsData) setGroups(groupsData);
  }, [groupsData]);

  const handleSaveTools = useCallback(() => {
    toolsMutation.mutate(tools, {
      onSuccess: () => toast.success("Tools config saved"),
      onError: (e) => toast.error(e.message),
    });
  }, [tools, toolsMutation]);

  const handleSaveGroups = useCallback(() => {
    groupsMutation.mutate(groups, {
      onSuccess: () => toast.success("Tool groups saved"),
      onError: (e) => toast.error(e.message),
    });
  }, [groups, groupsMutation]);

  if (toolsLoading || groupsLoading)
    return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="max-w-3xl space-y-8">
      {/* Tool Groups */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Tool Groups</h1>
          <Button
            size="sm"
            onClick={() => setGroups([...groups, { name: "" }])}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Group
          </Button>
        </div>
        {groups.map((g, i) => (
          <Card key={i} className="flex items-center gap-2 p-3">
            <Input
              value={g.name}
              placeholder="Group name"
              onChange={(e) => {
                const next = [...groups];
                next[i] = { ...next[i], name: e.target.value };
                setGroups(next);
              }}
            />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setGroups(groups.filter((_, j) => j !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </Card>
        ))}
        <Button onClick={handleSaveGroups} disabled={groupsMutation.isPending}>
          {groupsMutation.isPending ? "Saving..." : "Save Groups"}
        </Button>
      </section>

      {/* Tools */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Tools</h1>
          <Button
            size="sm"
            onClick={() => {
              setTools([...tools, { name: "", use: "" }]);
              setEditIdx(tools.length);
            }}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add Tool
          </Button>
        </div>

        {tools.map((t, idx) => (
          <Card key={idx} className="p-4">
            {editIdx === idx ? (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <ConfigFormField label="Name">
                    <Input
                      value={t.name}
                      onChange={(e) => {
                        const next = [...tools];
                        next[idx] = { ...t, name: e.target.value };
                        setTools(next);
                      }}
                    />
                  </ConfigFormField>
                  <ConfigFormField label="Group">
                    <Input
                      value={t.group ?? ""}
                      onChange={(e) => {
                        const next = [...tools];
                        next[idx] = { ...t, group: e.target.value };
                        setTools(next);
                      }}
                    />
                  </ConfigFormField>
                  <ConfigFormField label="Use (path)">
                    <Input
                      value={t.use}
                      onChange={(e) => {
                        const next = [...tools];
                        next[idx] = { ...t, use: e.target.value };
                        setTools(next);
                      }}
                    />
                  </ConfigFormField>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setEditIdx(null)}
                  >
                    Done
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setTools(tools.filter((_, j) => j !== idx));
                      setEditIdx(null);
                    }}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Remove
                  </Button>
                </div>
              </div>
            ) : (
              <div
                className="flex cursor-pointer items-center justify-between"
                onClick={() => setEditIdx(idx)}
              >
                <span className="font-medium">{t.name || "(unnamed)"}</span>
                <span className="text-xs text-muted-foreground">
                  {t.group && `[${t.group}] `}
                  {t.use}
                </span>
              </div>
            )}
          </Card>
        ))}

        <Button onClick={handleSaveTools} disabled={toolsMutation.isPending}>
          {toolsMutation.isPending ? "Saving..." : "Save Tools"}
        </Button>
      </section>
    </div>
  );
}
