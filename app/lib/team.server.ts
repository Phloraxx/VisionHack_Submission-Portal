/**
 * Shared server-side data helpers for teams, members, institutions, and
 * status transitions. These consolidate logic that was previously copy-
 * pasted across the lead / institution / admin / coordinator routes.
 *
 * Every function here reads and writes Postgres through the repositories in
 * `app/lib/db.server.ts`, which apply the §6.2 scope predicate in SQL.
 */
import { type ActionResult, fail } from "./action.server";
import { hashPassword } from "./auth.server";
import {
	type ActingUser,
	db,
	institutions,
	members,
	statusTransitions,
	teams,
	users,
} from "./db.server";
import { sendEmail } from "./email.server";
import { getAppUrl } from "./env.server";
import { sendPasswordResetEmail } from "./password-reset.server";
import { STATUS_LABELS } from "./team-status";
import { canTransition } from "./transitions";
import type { InstitutionRecord, Role, TeamStatus, TeamView } from "./types";
import { escapeHtml } from "./utils";

/**
 * The acting user for the admin-only helpers below.
 *
 * `createCampusLead` is only reachable from `admin/campus-leads.tsx`, whose
 * action is `secureAction({ roles: ["admin"] })`. Callers that have the real
 * user in hand should pass it as the third argument.
 */
const ADMIN_ACTOR: ActingUser = { id: "", role: "admin", institutionId: "" };

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * Fetch the single team led by `userId`, or null when none exists.
 *
 * The lookup is scoped to that lead (`leader_user_id = $userId`), so it can
 * only ever return a team the user leads.
 */
export async function getLeadTeam<T = TeamView>(
	userId: string,
	options?: { fields?: string; expand?: string },
): Promise<T | null> {
	void options;
	const team = await teams.findByLeader({ id: userId, role: "lead", institutionId: "" }, userId);
	return team as unknown as T | null;
}

/**
 * Resolve the institution owned by `userId` (its campus lead), or null.
 */
export async function getInstitutionForUser(
	userId: string,
	options?: { fields?: string; expand?: string },
): Promise<InstitutionRecord | null> {
	void options;
	return institutions.findByCampusLeadId(
		{ id: userId, role: "institution", institutionId: "" },
		userId,
	);
}

/**
 * Count members for a set of team ids in a single query.
 * Returns a `{ [teamId]: count }` map.
 *
 * `user` is optional only because the current call sites do not pass it yet;
 * the ids they send come from their own scoped team read. Pass the acting user
 * to have the §6.2 predicate applied here as well.
 */
export async function getMemberCountsForTeams(
	teamIds: string[],
	user?: ActingUser,
): Promise<Record<string, number>> {
	if (teamIds.length === 0) return {};
	return members.countByTeams(user, teamIds);
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

export interface TransitionArgs {
	teamId: string;
	to: TeamStatus;
	role: Role;
	/** When set, enforces the team belongs to this institution (IDOR guard). */
	institutionId?: string;
	actorUserId: string;
}

/**
 * Result of `transitionTeamStatus`. When `ok` is false, `response` is a
 * ready-to-return `fail()` action result. When `ok` is true the update has
 * already been applied.
 */
export type TransitionResult = { ok: true } | { ok: false; response: ActionResult };

/**
 * Validate and apply a team status transition.
 *
 * Performs:
 *  1. fetch the team, scoped to the actor (404 on miss — same as "not yours")
 *  2. optional institution IDOR check
 *  3. role-gated `canTransition` check
 *  4. optimistic-lock update with `status_changed_at`
 *  5. best-effort audit insert
 */
export async function transitionTeamStatus({
	teamId,
	to,
	role,
	institutionId,
	actorUserId,
}: TransitionArgs): Promise<TransitionResult> {
	const actor: ActingUser = { id: actorUserId, role, institutionId: institutionId ?? "" };

	const team = await teams.getOne(actor, teamId);
	if (!team) {
		return { ok: false, response: fail({ error: "Team not found", status: 404 }) };
	}

	if (institutionId && team.institutionId !== institutionId) {
		return { ok: false, response: fail({ error: "Team not found", status: 404 }) };
	}

	if (!canTransition(team.status, to, role)) {
		return {
			ok: false,
			response: fail({
				error: `Cannot transition from "${team.status}" to "${to}"`,
				status: 403,
			}),
		};
	}

	// Optimistic lock: `UPDATE … WHERE id = $1 AND status = $expected`. Zero
	// rows means someone else moved the team first (plan §6.1).
	const updated = await teams.update(
		actor,
		teamId,
		{ status: to, statusChangedAt: new Date().toISOString() },
		{ expectedStatus: team.status },
	);
	if (!updated) {
		return {
			ok: false,
			response: fail({
				error: "This team's status was changed by another action. Please refresh and try again.",
				status: 409,
			}),
		};
	}

	// Best-effort audit log — failures are logged but don't fail the transition.
	try {
		await statusTransitions.create(actor, {
			teamId,
			fromStatus: team.status,
			toStatus: to,
			at: new Date().toISOString(),
		});
	} catch (err) {
		console.error("[audit] Failed to log status transition:", err);
	}

	return { ok: true };
}

// ---------------------------------------------------------------------------
// Status-change notification email
// ---------------------------------------------------------------------------

export interface SendStatusChangeEmailArgs {
	to: string;
	leadName: string;
	teamName: string;
	status: TeamStatus;
}

/**
 * Send a status-change notification email to the team lead.
 * Best-effort: failures are logged but not thrown.
 */
export async function sendStatusChangeEmail(args: SendStatusChangeEmailArgs): Promise<void> {
	const statusLabel = STATUS_LABELS[args.status] || args.status;
	const dashboardUrl = `${getAppUrl()}/lead/dashboard`;

	const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 18px; margin: 0 0 16px;">Team Status Update — VisionHack 2026</h1>
      <p>Hello <strong>${escapeHtml(args.leadName)}</strong>,</p>
      <p>The status of your team <strong>${escapeHtml(args.teamName)}</strong> has been updated to <strong>${escapeHtml(statusLabel)}</strong>.</p>
      <p style="margin: 16px 0;">
        <a href="${dashboardUrl}"
           style="display: inline-block; background: #18181b; color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 14px;">
          Check Your Dashboard
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" />
      <p style="margin: 0; font-size: 12px; color: #71717a;">VisionHack Team</p>
    </div>
  `.trim();

	try {
		await sendEmail({
			to: args.to,
			// Subject is plain text (not HTML), so no HTML escaping needed.
			// The HTML body above uses escapeHtml() correctly.
			subject: `Team "${args.teamName.replace(/[\r\n]/g, "")}" status: ${statusLabel.replace(/[\r\n]/g, "")}`,
			html,
		});
	} catch (err) {
		console.error("[email] Failed to send status change notification:", err);
	}
}

// ---------------------------------------------------------------------------
// Campus lead creation
// ---------------------------------------------------------------------------

export interface CreateCampusLeadArgs {
	institutionName: string;
	district: string;
	code: string;
	leadName: string;
	leadEmail: string;
	maxTeams?: number;
}

export interface CreateCampusLeadResult {
	ok: boolean;
	error?: string;
}

/**
 * Create an institution + its campus-lead user, then send the app's
 * password-reset email so the lead sets their own password. Idempotency is
 * the caller's responsibility (check for an existing code/email first).
 *
 * `user` defaults to an admin actor because the only caller is the admin-only
 * campus-leads action; pass the real user to make the scope explicit.
 */
export async function createCampusLead(
	args: CreateCampusLeadArgs,
	user: ActingUser = ADMIN_ACTOR,
): Promise<CreateCampusLeadResult> {
	const {
		institutionName,
		district,
		code,
		leadName,
		leadEmail,
		maxTeams = DEFAULT_MAX_TEAMS,
	} = args;

	// The lead never learns this password — the reset email is how they get in.
	const tempPassword = crypto.randomUUID();
	const passwordHash = await hashPassword(tempPassword);

	let createdInstitutionId: string | null = null;
	let createdUserId: string | null = null;
	try {
		// Step 1: Create institution first (campusLeadId nullable).
		// This eliminates the window where a user exists with no institutionId.
		const institution = await institutions.create(user, {
			name: institutionName,
			district,
			code,
			maxTeams,
			status: "active",
		});
		if (!institution) throw new Error("Institution could not be created");
		createdInstitutionId = institution.id;

		// Step 2: Create user with institutionId set from the start.
		const campusLead = await users.create(user, {
			email: leadEmail,
			name: leadName,
			role: "institution",
			institutionId: institution.id,
			passwordHash,
		});
		if (!campusLead) throw new Error("Campus lead could not be created");
		createdUserId = campusLead.id;

		// Step 3: Back-link institution to the campus lead user.
		await institutions.update(user, institution.id, { campusLeadId: campusLead.id });
	} catch (err) {
		// Best-effort rollback of any partially-created records.
		if (createdUserId) {
			await users.delete(user, createdUserId).catch(() => {});
		}
		if (createdInstitutionId) {
			await institutions.delete(user, createdInstitutionId).catch(() => {});
		}
		throw err;
	}

	try {
		await sendPasswordResetEmail(db, leadEmail);
	} catch (err) {
		console.error("[team] campus-lead reset email failed:", err);
	}

	return { ok: true };
}

/** Default team capacity per institution. */
export const DEFAULT_MAX_TEAMS = 5;
