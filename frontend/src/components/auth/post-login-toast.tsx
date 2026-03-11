"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { useAuthSession } from "@/core/auth";

const AUTH_CALLBACK_PARAM = "auth_callback";

export function PostLoginToast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data } = useAuthSession();
  const handledKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (searchParams.get(AUTH_CALLBACK_PARAM) !== "1" || !data?.user) {
      return;
    }

    const handledKey = `${pathname}?${searchParams.toString()}`;
    if (handledKeyRef.current === handledKey) {
      return;
    }
    handledKeyRef.current = handledKey;

    const name = data.user.name?.trim();
    toast.success(name ? `欢迎回来，${name}` : "登录成功，欢迎回来。");

    const params = new URLSearchParams(searchParams.toString());
    params.delete(AUTH_CALLBACK_PARAM);
    const target = params.toString() ? `${pathname}?${params.toString()}` : pathname;
    router.replace(target);
  }, [data?.user, pathname, router, searchParams]);

  return null;
}
