"use client";

import {
  Bot,
  Brain,
  FileText,
  Hammer,
  LayoutDashboard,
  MessageSquare,
  Monitor,
  Plug,
  Settings,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const navItems = [
  { href: "/admin/models", label: "Models", icon: Bot },
  { href: "/admin/tools", label: "Tools", icon: Hammer },
  { href: "/admin/mcp", label: "MCP Servers", icon: Plug },
  { href: "/admin/skills", label: "Skills", icon: Sparkles },
  { href: "/admin/sandbox", label: "Sandbox", icon: Monitor },
  { href: "/admin/memory", label: "Memory", icon: Brain },
  { href: "/admin/title", label: "Title Generation", icon: FileText },
  { href: "/admin/summarization", label: "Summarization", icon: MessageSquare },
  { href: "/admin/subagents", label: "Subagents", icon: Settings },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-56 shrink-0 flex-col border-r bg-muted/30">
      <div className="flex h-14 items-center gap-2 border-b px-4">
        <LayoutDashboard className="h-5 w-5" />
        <span className="font-semibold">Admin</span>
      </div>
      <ScrollArea className="flex-1 py-2">
        <nav className="flex flex-col gap-0.5 px-2">
          {navItems.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground",
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </ScrollArea>
    </aside>
  );
}
