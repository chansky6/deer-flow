"use client";

import { Building2Icon, GithubIcon, LockIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuthSession } from "@/core/auth";
import { authClient } from "@/server/better-auth/client";

const LINUX_DO_ICON =
  "data:image/svg+xml;base64,PD94bWwgdmVyc2lvbj0iMS4wIiBlbmNvZGluZz0iVVRGLTgiPz4KPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZlcnNpb249IjEuMiIgYmFzZVByb2ZpbGU9InRpbnktcHMiIHdpZHRoPSIxMjgiIGhlaWdodD0iMTI4IiB2aWV3Qm94PSIwIDAgMTIwIDEyMCI+CiAgPGNsaXBQYXRoIGlkPSJhIj4KICAgIDxjaXJjbGUgY3g9IjYwIiBjeT0iNjAiIHI9IjQ3Ii8+CiAgPC9jbGlwUGF0aD4KICA8Y2lyY2xlIGZpbGw9IiNmMGYwZjAiIGN4PSI2MCIgY3k9IjYwIiByPSI1MCIvPgogIDxyZWN0IGZpbGw9IiMxYzFjMWUiIGNsaXAtcGF0aD0idXJsKCNhKSIgeD0iMTAiIHk9IjEwIiB3aWR0aD0iMTAwIiBoZWlnaHQ9IjMwIi8+CiAgPHJlY3QgZmlsbD0iI2YwZjBmMCIgY2xpcC1wYXRoPSJ1cmwoI2EpIiB4PSIxMCIgeT0iNDAiIHdpZHRoPSIxMDAiIGhlaWdodD0iNDAiLz4KICA8cmVjdCBmaWxsPSIjZmZiMDAzIiBjbGlwLXBhdGg9InVybCgjYSkiIHg9IjEwIiB5PSI4MCIgd2lkdGg9IjEwMCIgaGVpZ2h0PSIzMCIvPgo8L3N2Zz4K";
const AUTH_CALLBACK_PARAM = "auth_callback";
const W3_NOT_CONFIGURED_MESSAGE = "管理员尚未配置华为 W3 登录。";
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_OAUTH_CONFIGURATION: "OAuth 配置无效，请检查提供方配置。",
  INVALID_CALLBACK_URL: "登录回调地址无效。",
  INVALID_ERROR_CALLBACK_URL: "登录失败回调地址无效。",
  PROVIDER_NOT_FOUND: "当前登录方式不可用。",
  USER_NOT_FOUND: "未找到可登录的用户。",
  INVALID_TOKEN: "登录令牌无效，请重新发起登录。",
  INVALID_OAUTH_STATE: "登录状态已失效，请重新发起登录。",
  state_mismatch: "登录状态已失效，请重新发起登录。",
  please_restart_the_process: "登录流程已中断，请重新发起登录。",
  access_denied: "你已取消本次登录。",
  internal_server_error: "登录失败，服务内部错误。",
  "account not linked": "该账号尚未与当前用户关联。",
  "signup disabled": "当前站点不允许首次 OAuth 注册。",
  "unable to create user": "无法创建登录用户。",
  "unable to create session": "无法创建登录会话。",
};

type SignInCardProps = {
  w3Configured: boolean;
};

function getErrorMessage(error: unknown) {
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const errorRecord = error as Record<string, unknown>;
    if (typeof errorRecord.message === "string" && errorRecord.message.trim()) {
      return errorRecord.message;
    }
    if (errorRecord.error && typeof errorRecord.error === "object") {
      const nestedError = errorRecord.error as Record<string, unknown>;
      if (typeof nestedError.message === "string" && nestedError.message.trim()) {
        return nestedError.message;
      }
      if (typeof nestedError.code === "string" && nestedError.code.trim()) {
        return nestedError.code;
      }
    }
  }
  return "Unknown error";
}

function formatAuthError(rawError: string | null) {
  if (!rawError) {
    return null;
  }

  const normalizedError = rawError.trim();
  if (!normalizedError) {
    return null;
  }

  return (
    AUTH_ERROR_MESSAGES[normalizedError] ??
    AUTH_ERROR_MESSAGES[normalizedError.toUpperCase()] ??
    `登录失败，请重试。(${normalizedError})`
  );
}

export function SignInCard({ w3Configured }: SignInCardProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data, isPending } = useAuthSession();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const handledErrorRef = useRef<string | null>(null);

  const next = searchParams.get("next") ?? "/workspace";
  const authError =
    searchParams.get("error") ??
    searchParams.get("message") ??
    searchParams.get("error_description");

  const isActionPending = isPending || isSubmitting;

  const buildSuccessCallbackURL = () => {
    const url = new URL(next, window.location.origin);
    url.searchParams.set(AUTH_CALLBACK_PARAM, "1");
    return url.origin === window.location.origin
      ? `${url.pathname}${url.search}${url.hash}`
      : url.toString();
  };

  const buildErrorCallbackURL = () => {
    const url = new URL("/sign-in", window.location.origin);
    url.searchParams.set("next", next);
    return `${url.pathname}${url.search}`;
  };

  const handleOauth2SignIn = async (providerId: string) => {
    setIsSubmitting(true);
    try {
      await authClient.signIn.oauth2({
        providerId,
        callbackURL: buildSuccessCallbackURL(),
        errorCallbackURL: buildErrorCallbackURL(),
        fetchOptions: {
          throw: true,
        },
      });
    } catch (error) {
      toast.error(formatAuthError(getErrorMessage(error)) ?? "登录失败，请重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleW3SignIn = async () => {
    if (!w3Configured) {
      toast.error(W3_NOT_CONFIGURED_MESSAGE);
      return;
    }

    await handleOauth2SignIn("w3");
  };

  const handleLinuxDoSignIn = async () => {
    await handleOauth2SignIn("oidc");
  };

  const handleGithubSignIn = async () => {
    setIsSubmitting(true);
    try {
      await authClient.signIn.social({
        provider: "github",
        callbackURL: buildSuccessCallbackURL(),
        errorCallbackURL: buildErrorCallbackURL(),
        fetchOptions: {
          throw: true,
        },
      });
    } catch (error) {
      toast.error(formatAuthError(getErrorMessage(error)) ?? "登录失败，请重试。");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (data?.user) {
      router.replace(next);
    }
  }, [data?.user, next, router]);

  useEffect(() => {
    const errorMessage = formatAuthError(authError);
    if (!errorMessage || handledErrorRef.current === authError) {
      return;
    }

    handledErrorRef.current = authError;
    toast.error(errorMessage);
    const params = new URLSearchParams(searchParams.toString());
    params.delete("error");
    params.delete("message");
    params.delete("error_description");
    const target = params.toString() ? `/sign-in?${params.toString()}` : "/sign-in";
    router.replace(target);
  }, [authError, router, searchParams]);

  return (
    <>
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-2 text-center">
            <div className="mx-auto flex size-10 items-center justify-center rounded-full border">
              <LockIcon className="size-5" />
            </div>
            <CardTitle>Sign in to DeerFlow</CardTitle>
            <CardDescription>
              Continue with one of the available sign-in providers.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button disabled={isActionPending} onClick={handleW3SignIn}>
              <Building2Icon className="size-4" />
              Continue with Huawei W3
            </Button>
            <Button
              variant="outline"
              disabled={isActionPending}
              onClick={handleLinuxDoSignIn}
            >
              <img alt="" className="size-4 rounded-full" src={LINUX_DO_ICON} />
              Continue with LinuxDo
            </Button>
            <Button
              variant="outline"
              disabled={isActionPending}
              onClick={handleGithubSignIn}
            >
              <GithubIcon className="size-4" />
              Continue with GitHub
            </Button>
          </CardContent>
        </Card>
      </main>
      <Toaster position="top-center" />
    </>
  );
}
