import "server-only";

import { createHmac } from "node:crypto";

import { env } from "@/env";

type InternalAuthClaims = {
  sub: string;
  email: string | null;
  is_admin: boolean;
  auth_provider: string | null;
  session_id: string;
  iat: number;
  exp: number;
};

function base64urlEncode(value: string) {
  return Buffer.from(value)
    .toString("base64url");
}

function sign(value: string) {
  const secret = env.INTERNAL_AUTH_JWT_SECRET || env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error("INTERNAL_AUTH_JWT_SECRET or BETTER_AUTH_SECRET is required.");
  }

  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function createInternalAuthToken(claims: Omit<InternalAuthClaims, "iat" | "exp">) {
  const now = Math.floor(Date.now() / 1000);
  const ttl = Number(env.INTERNAL_AUTH_JWT_TTL_SECONDS || "300");
  const payload: InternalAuthClaims = {
    ...claims,
    iat: now,
    exp: now + ttl,
  };

  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(payload));
  const signature = sign(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}
