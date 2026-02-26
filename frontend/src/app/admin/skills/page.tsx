"use client";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useSkills, useEnableSkill } from "@/core/skills/hooks";

export default function SkillsPage() {
  const { skills, isLoading } = useSkills();
  const enableMutation = useEnableSkill();

  if (isLoading)
    return <div className="text-muted-foreground">Loading...</div>;

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Skills</h1>
      <p className="text-sm text-muted-foreground">
        Changes take effect immediately (mtime-based detection).
      </p>

      {skills.length === 0 && (
        <p className="text-muted-foreground">No skills found.</p>
      )}

      {skills.map((skill) => (
        <Card
          key={skill.name}
          className="flex items-center justify-between p-4"
        >
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium">{skill.name}</span>
              <Badge variant="outline">{skill.category}</Badge>
            </div>
            {skill.description && (
              <p className="text-sm text-muted-foreground">
                {skill.description}
              </p>
            )}
          </div>
          <Switch
            checked={skill.enabled}
            onCheckedChange={(enabled) =>
              enableMutation.mutate({ skillName: skill.name, enabled })
            }
          />
        </Card>
      ))}
    </div>
  );
}
