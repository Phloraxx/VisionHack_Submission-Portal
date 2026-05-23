import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const API_KEY = "shipyard-api-key-change-in-prod";

export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (!pathname.startsWith("/shipyard")) {
    return NextResponse.next();
  }

  const base = process.env.NEXT_PUBLIC_SHIPYARD_URL || "https://shipyard.mulearnscet.in";
  const targetPath = pathname.replace(/^\/shipyard/, "") || "/";
  const url = `${base}${targetPath}${search}`;

  const headers = new Headers(request.headers);
  headers.set("x-api-key", API_KEY);
  headers.delete("host");

  const body = request.method !== "GET" && request.method !== "HEAD"
    ? await request.text()
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

  response.headers.forEach((value, key) => {
    res.headers.set(key, value);
  });

  return res;
}

export const config = {
  matcher: "/shipyard/:path*",
};
