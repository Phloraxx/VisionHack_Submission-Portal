/**
 * Submission-file download — streams a team's upload from `$UPLOADS_DIR`
 * after the same ownership checks the old backend's view rule applied.
 *
 * GET /api/files/:collection/:recordId/:filename
 */
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { LoaderFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
import { teams } from "~/lib/db.server";
import { getTeamSubmissionPath } from "~/lib/uploads.server";

/** Content types for the extensions `submit-idea` accepts. */
const CONTENT_TYPES: Record<string, string> = {
	pdf: "application/pdf",
	ppt: "application/vnd.ms-powerpoint",
	pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

function contentTypeFor(filename: string): string {
	const ext = filename.split(".").pop()?.toLowerCase() ?? "";
	return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

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
	// Team ids are uuids. The repository guards the uuid cast too, so a
	// malformed id reads as "not found" rather than a 500.
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recordId)) {
		return new Response("Not found", { status: 404 });
	}

	// Authorize: confirm the requesting user is allowed to view this
	// team's record. `teams.getOne` applies the §6.2 scope predicate in SQL
	// (admin/coordinator: any team, institution: own institution, lead: own
	// team), so an out-of-scope id reads as "not found" — the same answer
	// the old backend's view rule gave. The explicit `canRead` check below
	// stays as defence in depth.
	const team = await teams.getOne(user, recordId);
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

	const attached = (team.submissionFile ?? "")
		.split(",")
		.map((f: string) => f.trim())
		.filter(Boolean);
	if (!attached.includes(filename)) {
		return new Response("Not found", { status: 404 });
	}

	// The row stores the filename only; the directory comes from the team id,
	// so the client can never choose a path. `getTeamSubmissionPath` re-checks
	// that the result stays inside `$UPLOADS_DIR/teams/<id>/`.
	const filePath = getTeamSubmissionPath(team.id, filename);
	if (!filePath) {
		return new Response("Not found", { status: 404 });
	}

	let size: number;
	try {
		const stats = await stat(filePath);
		if (!stats.isFile()) {
			return new Response("Not found", { status: 404 });
		}
		size = stats.size;
	} catch {
		return new Response("Not found", { status: 404 });
	}

	const headers = new Headers();
	headers.set("Content-Type", contentTypeFor(filename));
	const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
	headers.set("Content-Disposition", `attachment; filename="${safeFilename}"`);
	headers.set("Content-Length", String(size));
	// Files are served only to authenticated users; cache privately for an hour.
	headers.set("Cache-Control", "private, max-age=3600");

	return new Response(Readable.toWeb(createReadStream(filePath)) as ReadableStream, {
		status: 200,
		headers,
	});
}
