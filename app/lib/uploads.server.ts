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

/** Filenames the download route accepts — no separators, no `.`/`..`. */
const SAFE_FILENAME = /^[\w.\-]+$/;

/** `SAFE_FILENAME` plus the dot-segment check the regex alone cannot express. */
function isSafeFilename(name: string): boolean {
	return SAFE_FILENAME.test(name) && name !== "." && name !== "..";
}

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
 * Write a team's submission file.
 *
 * The bytes land in a temp name first and are renamed into place, so a crash
 * mid-write leaves the previous file intact rather than truncated. The
 * superseded file is deliberately *not* removed here: the caller unlinks it
 * with `pruneTeamSubmissions` once the row naming the new file has committed.
 *
 * Invariant: the file named by `teams.submission_file` exists on disk at every
 * point outside a successful commit. Removing the old file before the row
 * moves would leave the row pointing at nothing if the update lost its
 * optimistic lock.
 *
 * Returns the stored filename.
 */
export async function saveTeamSubmission(
	teamId: string,
	filename: string,
	bytes: Buffer | Uint8Array,
): Promise<string> {
	const dir = teamDir(teamId);
	if (!dir) throw new Error(`Invalid team id for upload: ${teamId}`);
	if (!isSafeFilename(filename)) throw new Error(`Invalid upload filename: ${filename}`);

	await mkdir(dir, { recursive: true });
	const tmp = path.join(dir, `.tmp-${randomUUID()}`);
	await writeFile(tmp, bytes);
	await rename(tmp, path.join(dir, filename));

	return filename;
}

/**
 * Drop every submission file in the team directory except `keep`.
 *
 * Call this only after the row naming `keep` has committed. Best-effort: a
 * stale file left behind is harmless, a failed request is not. `.tmp-*` names
 * belong to concurrent uploads and are left alone.
 */
export async function pruneTeamSubmissions(teamId: string, keep: string): Promise<void> {
	const dir = teamDir(teamId);
	if (!dir) return;
	const existing = await readdir(dir).catch(() => [] as string[]);
	for (const name of existing) {
		if (name !== keep && !name.startsWith(".tmp-")) {
			await unlink(path.join(dir, name)).catch(() => {});
		}
	}
}

/**
 * Remove a stored submission file. Best-effort: a missing file is not an
 * error, because the caller is usually compensating for a failed write.
 */
export async function deleteTeamSubmission(teamId: string, filename: string): Promise<void> {
	const resolved = getTeamSubmissionPath(teamId, filename);
	if (!resolved) return;
	await unlink(resolved).catch(() => {});
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
	if (!isSafeFilename(filename)) return null;
	const resolved = path.resolve(dir, filename);
	return path.dirname(resolved) === dir ? resolved : null;
}
