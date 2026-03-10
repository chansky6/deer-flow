import { toNextJsHandler } from "better-auth/next-js";
import type { NextRequest } from "next/server";

import { auth } from "@/server/better-auth";
import { ensureBetterAuthReady } from "@/server/better-auth/config";

const handler = toNextJsHandler(auth.handler);

export async function GET(request: NextRequest) {
  await ensureBetterAuthReady();
  return handler.GET(request);
}

export async function POST(request: NextRequest) {
  await ensureBetterAuthReady();
  return handler.POST(request);
}
