// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

"use client";

import { GithubOutlined, LogoutOutlined } from "@ant-design/icons";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useCallback, useEffect, useState } from "react";

import { Button } from "~/components/ui/button";

import { Logo } from "../../components/deer-flow/logo";
import { ThemeToggle } from "../../components/deer-flow/theme-toggle";
import { Tooltip } from "../../components/deer-flow/tooltip";
import { useConfig } from "../../core/api/hooks";
import { resolveServiceURL } from "../../core/api/resolve-service-url";
import { SettingsDialog } from "../settings/dialogs/settings-dialog";
import { ConversationSidebar } from "./components/conversation-sidebar";

const Main = dynamic(() => import("./main"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center">
      Loading DeerFlow...
    </div>
  ),
});

interface AuthUser {
  id: string;
  username: string;
  avatar_url: string;
}

export default function HomePage() {
  const t = useTranslations("chat.page");
  const tAuth = useTranslations("auth");
  const router = useRouter();
  const { config, loading: configLoading } = useConfig();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    if (configLoading) return;
    if (!config.auth.enabled) {
      setAuthChecked(true);
      return;
    }
    fetch(resolveServiceURL("auth/me"), { credentials: "include" })
      .then((res) => {
        if (res.ok) return res.json();
        throw new Error("Not authenticated");
      })
      .then((data: AuthUser) => {
        setUser(data);
        setAuthChecked(true);
      })
      .catch(() => {
        router.push("/login");
      });
  }, [config.auth.enabled, configLoading, router]);

  const handleLogout = useCallback(async () => {
    await fetch(resolveServiceURL("auth/logout"), {
      method: "POST",
      credentials: "include",
    });
    router.push("/login");
  }, [router]);

  if (configLoading || (!authChecked && config.auth.enabled)) {
    return (
      <div className="flex h-screen w-screen items-center justify-center">
        {tAuth("loading")}
      </div>
    );
  }

  return (
    <div className="flex h-screen w-screen overscroll-none">
      {user && <ConversationSidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 w-full shrink-0 items-center justify-between px-4">
          <Logo />
          <div className="flex items-center gap-1">
            {user && (
              <span className="text-muted-foreground mr-1 text-sm">
                {user.username}
              </span>
            )}
            <Tooltip title={t("starOnGitHub")}>
              <Button variant="ghost" size="icon" asChild>
                <Link
                  href="https://github.com/bytedance/deer-flow"
                  target="_blank"
                >
                  <GithubOutlined />
                </Link>
              </Button>
            </Tooltip>
            <ThemeToggle />
            <Suspense>
              <SettingsDialog />
            </Suspense>
            {user && (
              <Tooltip title={tAuth("logout")}>
                <Button variant="ghost" size="icon" onClick={handleLogout}>
                  <LogoutOutlined />
                </Button>
              </Tooltip>
            )}
          </div>
        </header>
        <div className="flex-1 overflow-hidden">
          <Main />
        </div>
      </div>
    </div>
  );
}
