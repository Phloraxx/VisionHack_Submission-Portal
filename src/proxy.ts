import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!pathname.startsWith("/shipyard")) {
    return NextResponse.next();
  }

  const apiKey = process.env.SHIPYARD_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ message: "Server misconfiguration: missing SHIPYARD_API_KEY" }, { status: 500 });
  }

  const base = process.env.NEXT_PUBLIC_SHIPYARD_URL;
  if (!base) {
    return NextResponse.json({ message: "Server misconfiguration: missing NEXT_PUBLIC_SHIPYARD_URL" }, { status: 500 });
  }
  const targetPath = pathname.replace(/^\/shipyard/, "") || "/";
  const url = `${base}${targetPath}${search}`;

  const headers = new Headers(request.headers);
  headers.set("x-api-key", apiKey);
  headers.delete("host");

  const body = request.method !== "GET" && request.method !== "HEAD"
    ? await request.blob()
    : undefined;

  const response = await fetch(url, {
    method: request.method,
    headers,
    body,
  });

  const res = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
  });

  const skipHeaders = new Set(["content-encoding", "content-length", "transfer-encoding"]);
  response.headers.forEach((value, key) => {
    if (!skipHeaders.has(key.toLowerCase())) {
      res.headers.set(key, value);
    }
  });

  return res;
}

export const config = {
  matcher: "/shipyard/:path*",
};
