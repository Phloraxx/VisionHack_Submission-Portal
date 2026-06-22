/**
 * File download proxy — prevents exposing the internal PocketBase URL
 * to the browser and enforces ownership checks server-side.
 *
 * GET /api/files/:collection/:recordId/:filename
 */
import type { LoaderFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
import { getAdminClient } from "~/lib/pocketbase.server";
import { getEnv } from "~/lib/env.server";

export async function loader({ request, params }: LoaderFunctionArgs) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const auth = await requireAuthJson(request);
  if (auth instanceof Response) return auth;
  const { user } = auth;

  const { collection, recordId, filename } = params as {
    collection: string;
    recordId: string;
    filename: string;
  };

  if (!collection || !recordId || !filename) {
    return new Response("Invalid path", { status: 400 });
  }
  if (collection !== "teams") {
    return new Response("Not found", { status: 404 });
  }
  if (filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    return new Response("Invalid filename", { status: 400 });
  }
  if (!/^[A-Za-z0-9]{15}$/.test(recordId)) {
    return new Response("Not found", { status: 404 });
  }

  // Authorize: confirm the requesting user is allowed to view this
  // team's record. The PB schema's `viewRule` for `teams` does this
  // already, but we re-check here so the file proxy is safe to keep
  // even if the schema rules regress.
  const team = await auth.pb.collection("teams")
    .getOne(recordId, { fields: "id,institutionId,leaderUserId,submission_file" })
    .catch(() => null);
  if (!team) {
    return new Response("Not found", { status: 404 });
  }

  const canRead =
    user.role === "admin" ||
    user.role === "coordinator" ||
    (user.role === "institution" && user.institutionId === team.institutionId) ||
    (user.role === "lead" && user.id === team.leaderUserId);
  if (!canRead) {
    return new Response("Forbidden", { status: 403 });
  }

  const attached = (team.submission_file ?? "")
    .split(",")
    .map((f: string) => f.trim())
    .filter(Boolean);
  if (!attached.includes(filename)) {
    return new Response("Not found", { status: 404 });
  }

  const pbUrl = getEnv().POCKETBASE_URL.replace(/\/+$/, "");
  const fileUrl = `${pbUrl}/api/files/${collection}/${recordId}/${filename}`;

  // Fetch the file with the admin client so the proxy doesn't depend on
  // the requesting user's own PB file read rights.
  const adminPb = await getAdminClient();
  const token = adminPb.authStore.token;

  try {
    const response = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return new Response("File not found", { status: 404 });
    }

    const headers = new Headers();
    const contentType = response.headers.get("Content-Type");
    if (contentType) headers.set("Content-Type", contentType);

    const disposition = response.headers.get("Content-Disposition");
    headers.set(
      "Content-Disposition",
      disposition ?? `attachment; filename="${filename}"`,
    );

    // Forward Content-Length so clients can show progress bars
    const contentLength = response.headers.get("Content-Length");
    if (contentLength) headers.set("Content-Length", contentLength);

    // Files are served only to authenticated users; cache privately for an hour.
    headers.set("Cache-Control", "private, max-age=3600");

    return new Response(response.body, { status: 200, headers });
  } catch {
    return new Response("Failed to fetch file", { status: 502 });
  }
}
