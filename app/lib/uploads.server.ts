/**
 * Submission-file storage on the local volume (`$UPLOADS_DIR`).
 *
 * Layout (plan §4.1):
 *
 *   $UPLOADS_DIR/teams/<team uuid>/<sanitized filename>
 *
 * `teams.submission_file` stores the filename only; the directory is derived
 * from the row's id, never from the request.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "./env.server";

/** Filenames the download route accepts — no separators, no `..`. */
const SAFE_FILENAME = /^[\w.\-]+$/;

/** `$UPLOADS_DIR/teams` — the only root either function may touch. */
function teamsRoot(): string {
	return path.resolve(getEnv().UPLOADS_DIR, "teams");
}

/**
 * Absolute directory for one team, or null when `teamId` would escape the
 * teams root. Ids are uuids, so this only fires on a programming error.
 */
function teamDir(teamId: string): string | null {
	const root = teamsRoot();
	const dir = path.resolve(root, teamId);
	return path.dirname(dir) === root ? dir : null;
}

/**
 * Write a team's submission file and drop the superseded one.
 *
 * The directory holds exactly one submission per team, so any other file in
 * it is the previous upload and is removed once the new bytes have landed.
 * Returns the stored filename.
 */
export async function saveTeamSubmission(
	teamId: string,
	filename: string,
	bytes: Buffer | Uint8Array,
): Promise<string> {
	const dir = teamDir(teamId);
	if (!dir) throw new Error(`Invalid team id for upload: ${teamId}`);
	if (!SAFE_FILENAME.test(filename)) throw new Error(`Invalid upload filename: ${filename}`);

	await mkdir(dir, { recursive: true });
	// Atomic-ish write (plan 4.2 step 5): bytes land in a temp name first, so
	// a crash mid-upload leaves the previous file intact, never truncated.
	// Leftover temp files are swept by the stale-file loop below.
	const tmp = path.join(dir, `.tmp-${randomUUID()}`);
	await writeFile(tmp, bytes);
	await rename(tmp, path.join(dir, filename));

	// Best effort: a stale file left behind is harmless, a failed upload is not.
	const existing = await readdir(dir).catch(() => [] as string[]);
	for (const name of existing) {
		if (name !== filename) await unlink(path.join(dir, name)).catch(() => {});
	}

	return filename;
}

/**
 * Resolve a stored submission file to an absolute path.
 *
 * Returns null unless the result stays inside the team's own directory, so a
 * crafted filename can never read outside the volume.
 */
export function getTeamSubmissionPath(teamId: string, filename: string): string | null {
	const dir = teamDir(teamId);
	if (!dir) return null;
	if (!SAFE_FILENAME.test(filename)) return null;
	const resolved = path.resolve(dir, filename);
	return path.dirname(resolved) === dir ? resolved : null;
}
