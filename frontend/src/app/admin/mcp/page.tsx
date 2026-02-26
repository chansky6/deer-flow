"use client";

import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useMCPConfig, useEnableMCPServer } from "@/core/mcp/hooks";

export default function MCPPage() {
  const { config, isLoading } = useMCPConfig();
  const enableMutation = useEnableMCPServer();

  if (isLoading)
    return <div className="text-muted-foreground">Loading...</div>;

  const servers = config?.mcp_servers ?? {};
  const names = Object.keys(servers);

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">MCP Servers</h1>
      <p className="text-sm text-muted-foreground">
        Changes take effect immediately (mtime-based detection).
      </p>

      {names.length === 0 && (
        <p className="text-muted-foreground">
          No MCP servers configured. Edit extensions_config.json to add servers.
        </p>
      )}

      {names.map((name) => {
        const server = servers[name]!;
        return (
          <Card key={name} className="flex items-center justify-between p-4">
            <div>
              <span className="font-medium">{name}</span>
              {server.description && (
                <p className="text-sm text-muted-foreground">
                  {server.description}
                </p>
              )}
            </div>
            <Switch
              checked={server.enabled}
              onCheckedChange={(enabled) =>
                enableMutation.mutate({ serverName: name, enabled })
              }
            />
          </Card>
        );
      })}
    </div>
  );
}
