/**
 * File download proxy — prevents exposing the internal PocketBase URL
 * to the browser. All file downloads go through this route, which
 * fetches from PocketBase server-side and streams the response.
 *
 * GET /api/files/:collection/:recordId/:filename
 */
import type { LoaderFunctionArgs } from "react-router";
import { requireAuth, getAuthFromCookie } from "~/lib/auth.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Require authentication — no unauthenticated file access
  const token = getAuthFromCookie(request);
  if (!token) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { collection, recordId, filename } = params as {
    collection: string;
    recordId: string;
    filename: string;
  };

  if (!collection || !recordId || !filename) {
    return new Response("Invalid path", { status: 400 });
  }

  // Only allow downloads from the "teams" collection
  if (collection !== "teams") {
    return new Response("Not found", { status: 404 });
  }

  // Validate filename contains no path traversal
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return new Response("Invalid filename", { status: 400 });
  }

  // Construct the PocketBase file URL (server-side only)
  const { getEnv } = await import("~/lib/env.server");
  const pbUrl = getEnv().POCKETBASE_URL.replace(/\/+$/, "");
  const fileUrl = `${pbUrl}/api/files/${collection}/${recordId}/${filename}`;

  try {
    const response = await fetch(fileUrl, {
      headers: {
        // Forward the auth token so PocketBase can verify access
        Authorization: token,
      },
    });

    if (!response.ok) {
      return new Response("File not found", { status: 404 });
    }

    // Stream the file back to the client
    const headers = new Headers();
    const contentType = response.headers.get("Content-Type");
    if (contentType) headers.set("Content-Type", contentType);

    const disposition = response.headers.get("Content-Disposition");
    if (disposition) {
      headers.set("Content-Disposition", disposition);
    } else {
      headers.set(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
    }

    // Cache publicly for 1 hour (files are immutable once uploaded)
    headers.set("Cache-Control", "public, max-age=3600");

    return new Response(response.body, {
      status: 200,
      headers,
    });
  } catch {
    return new Response("Failed to fetch file", { status: 502 });
  }
}
