// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

"use client";

import { useTranslations } from "next-intl";

import { Button } from "~/components/ui/button";

import { Logo } from "../../components/deer-flow/logo";
import { resolveServiceURL } from "../../core/api/resolve-service-url";

export default function LoginPage() {
  const t = useTranslations("auth");

  const handleLogin = () => {
    window.location.href = resolveServiceURL("auth/login");
  };

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-8">
      <Logo />
      <p className="text-muted-foreground text-sm">{t("loginRequired")}</p>
      <Button onClick={handleLogin}>{t("loginWithProvider")}</Button>
    </div>
  );
}
