"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

export function AdminHeader() {
  return (
    <header className="flex h-14 items-center gap-4 border-b px-6">
      <Button variant="ghost" size="sm" asChild>
        <Link href="/workspace">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Workspace
        </Link>
      </Button>
      <div className="flex-1" />
      <span className="text-sm text-muted-foreground">
        Changes to config.yaml take effect in the next new session
      </span>
    </header>
  );
}
