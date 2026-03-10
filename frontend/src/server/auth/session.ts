import "server-only";

import { cache } from "react";

import { getSession } from "@/server/better-auth/server";

export type AppSession = {
  sessionId: string;
  userId: string;
  email: string | null;
  name: string | null;
  image: string | null;
  isAdmin: boolean;
  authProvider: string | null;
};

export const getAppSession = cache(async (): Promise<AppSession | null> => {
  const session = await getSession();
  if (!session?.session || !session.user) {
    return null;
  }

  return {
    sessionId: session.session.id,
    userId: session.user.id,
    email: session.user.email ?? null,
    name: session.user.name ?? null,
    image: session.user.image ?? null,
    isAdmin: Boolean((session.user as { isAdmin?: boolean }).isAdmin),
    authProvider: null,
  };
});

export async function requireAppSession() {
  const session = await getAppSession();
  if (!session) {
    throw new Error("UNAUTHENTICATED");
  }
  return session;
}
