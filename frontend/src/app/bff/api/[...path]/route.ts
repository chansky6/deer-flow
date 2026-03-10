import type { NextRequest } from "next/server";

import { env } from "@/env";
import { createInternalAuthToken } from "@/server/auth/internal-jwt";
import { getAppSession } from "@/server/auth/session";

const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function getGatewayBaseUrl() {
  return env.BACKEND_BASE_URL || env.NEXT_PUBLIC_BACKEND_BASE_URL || "http://localhost:8001";
}

function copyHeaders(headers: Headers) {
  const nextHeaders = new Headers();
  headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      nextHeaders.set(key, value);
    }
  });
  return nextHeaders;
}

async function proxy(request: NextRequest, path: string[]) {
  const session = await getAppSession();
  if (!session) {
    return Response.json({ detail: "Authentication required" }, { status: 401 });
  }

  const token = createInternalAuthToken({
    sub: session.userId,
    email: session.email,
    is_admin: session.isAdmin,
    auth_provider: null,
    session_id: session.sessionId,
  });

  const gatewayPath = path[0] === "langgraph"
    ? `/api/langgraph/${path.slice(1).join("/")}`
    : `/api/${path.join("/")}`;
  const url = new URL(`${getGatewayBaseUrl()}${gatewayPath}`);
  url.search = request.nextUrl.search;

  const headers = copyHeaders(request.headers);
  headers.set("Authorization", `Bearer ${token}`);
  headers.delete("cookie");

  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers,
    redirect: "manual",
  };

  if (BODY_METHODS.has(request.method)) {
    init.body = request.body;
    init.duplex = "half";
  }

  const upstream = await fetch(url, init);
  const responseHeaders = copyHeaders(upstream.headers);
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, (await context.params).path);
}
