/**
 * File download proxy — prevents exposing the internal PocketBase URL
 * to the browser and enforces ownership checks server-side.
 *
 * GET /api/files/:collection/:recordId/:filename
 */
import type { LoaderFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
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
	if (!/^[A-Za-z0-9]{10,30}$/.test(recordId)) {
		return new Response("Not found", { status: 404 });
	}

	// Authorize: confirm the requesting user is allowed to view this
	// team's record. The PB schema's `viewRule` for `teams` enforces the
	// same scoping at the storage layer (re-checked below via the file
	// token), but we re-check here to return a clean 403 before the
	// fetch and so the proxy stays safe even if the schema rules regress.
	const team = await auth.pb
		.collection("teams")
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
	const fileUrl = `${pbUrl}/api/files/${collection}/${recordId}/${encodeURIComponent(filename)}`;

	// Fetch the file via PocketBase's protected-file flow: mint a
	// short-lived file token from the requesting user's own auth client,
	// then request the bytes with `?token=…`. PB evaluates the `teams`
	// `viewRule` against the user's auth record when issuing the token,
	// so this enforces ownership at the storage layer too — defense in
	// depth on top of the `canRead` check above. No superuser credentials
	// are involved.
	const fileToken = await auth.pb.files.getToken();

	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 30_000);
		const response = await fetch(`${fileUrl}?token=${encodeURIComponent(fileToken)}`, {
			signal: controller.signal,
		});
		clearTimeout(timeoutId);

		if (!response.ok) {
			return new Response("File not found", { status: 404 });
		}

		const headers = new Headers();
		const contentType = response.headers.get("Content-Type");
		if (contentType) headers.set("Content-Type", contentType);

		const disposition = response.headers.get("Content-Disposition");
		const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
		headers.set("Content-Disposition", disposition ?? `attachment; filename="${safeFilename}"`);

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
