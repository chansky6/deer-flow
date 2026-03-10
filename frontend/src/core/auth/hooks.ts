"use client";

import { authClient } from "@/server/better-auth/client";

export function useAuthSession() {
  const session = authClient.useSession();
  const isAdmin = Boolean((session.data?.user as { isAdmin?: boolean } | undefined)?.isAdmin);

  return {
    ...session,
    isAdmin,
  };
}
