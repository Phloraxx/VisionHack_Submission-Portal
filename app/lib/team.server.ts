/**
 * Shared server-side data helpers for teams, members, institutions, and
 * status transitions. These consolidate logic that was previously copy-
 * pasted across the lead / institution / admin / coordinator routes.
 */
import type PocketBase from "pocketbase";
import { fail, type ActionResult } from "./action.server";
import { canTransition } from "./types";
import type {
  Role,
  TeamStatus,
  TeamRecord,
  TeamView,
  InstitutionRecord,
} from "./types";
import { countByKey } from "./utils";
import { getAppUrl } from "./env.server";
import { sendEmail } from "./email.server";
import { escapeHtml } from "./utils";
import { STATUS_LABELS } from "./team-status";

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

/**
 * Fetch the single team led by `userId`, or null when none exists.
 * Uses `getFirstListItem` (one record) rather than a full-list scan.
 */
export async function getLeadTeam<T = TeamView>(
  pb: PocketBase,
  userId: string,
  options?: { fields?: string; expand?: string },
): Promise<T | null> {
  return pb
    .collection("teams")
    .getFirstListItem<T>(
      pb.filter("leaderUserId = {:userId}", { userId }),
      options,
    )
    .catch(() => null);
}

/**
 * Resolve the institution owned by `userId` (its campus lead), or null.
 */
export async function getInstitutionForUser(
  pb: PocketBase,
  userId: string,
  options?: { fields?: string; expand?: string },
): Promise<InstitutionRecord | null> {
  return pb
    .collection("institutions")
    .getFirstListItem<InstitutionRecord>(
      pb.filter("campusLeadId = {:id}", { id: userId }),
      options,
    )
    .catch(() => null);
}

/**
 * Count members for a set of team ids in a single query.
 * Returns a `{ [teamId]: count }` map.
 */
export async function getMemberCountsForTeams(
  pb: PocketBase,
  teamIds: string[],
): Promise<Record<string, number>> {
  if (teamIds.length === 0) return {};
  const members = await pb
    .collection("members")
    .getFullList<{ teamId: string }>({
      filter: pb.filter(
        teamIds.map((_, i) => `teamId = {:t${i}}`).join(" || "),
        Object.fromEntries(teamIds.map((id, i) => [`t${i}`, id])),
      ),
      fields: "teamId",
    });
  return countByKey(members, (m) => m.teamId);
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
export type TransitionResult =
  | { ok: true }
  | { ok: false; response: ActionResult };

/**
 * Validate and apply a team status transition.
 *
 * Performs:
 *  1. fetch the team (404 on miss — same as "not yours")
 *  2. optional institution IDOR check
 *  3. role-gated `canTransition` check
 *  4. update with `status_changed_at`
 */
export async function transitionTeamStatus(
  pb: PocketBase,
  { teamId, to, role, institutionId, actorUserId }: TransitionArgs,
): Promise<TransitionResult> {
  let team: TeamRecord;
  try {
    team = await pb
      .collection("teams")
      .getOne<TeamRecord>(teamId, { fields: "id,status,institutionId" });
  } catch {
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

  try {
    await pb.collection("teams").update(teamId, {
      status: to,
      status_changed_at: new Date().toISOString(),
    }, { filter: pb.filter("status = {:expected}", { expected: team.status }) });
  } catch {
    return { ok: false, response: fail({ error: "This team's status was changed by another action. Please refresh and try again.", status: 409 }) };
  }
  // Best-effort audit log — failures are logged but don't fail the transition.
  try {
    await pb.collection("status_transitions").create({
      teamId,
      actorUserId,
      fromStatus: team.status,
      toStatus: to,
      role,
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
export async function sendStatusChangeEmail(
  args: SendStatusChangeEmailArgs,
): Promise<void> {
  const statusLabel = STATUS_LABELS[args.status] || args.status;
  const dashboardUrl = `${getAppUrl()}/lead/dashboard`;

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 18px; margin: 0 0 16px;">Team Status Update — VisionHack 2026</h1>
      <p>Hello <strong>${escapeHtml(args.leadName)}</strong>,</p>
      <p>The status of your team <strong>${escapeHtml(args.teamName)}</strong> has been updated to <strong>${escapeHtml(statusLabel)}</strong>.</p>
      <p style="margin: 16px 0;">
        <a href="${escapeHtml(dashboardUrl)}"
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
      subject: `Team "${args.teamName}" status: ${statusLabel}`,
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
 * Create an institution + its campus-lead user, then trigger PocketBase's
 * password-reset email so the lead sets their own password. Idempotency is
 * the caller's responsibility (check for an existing code/email first).
 */
export async function createCampusLead(
  pb: PocketBase,
  args: CreateCampusLeadArgs,
): Promise<CreateCampusLeadResult> {
  const {
    institutionName,
    district,
    code,
    leadName,
    leadEmail,
    maxTeams = DEFAULT_MAX_TEAMS,
  } = args;

  const tempPassword = crypto.randomUUID();
  const campusLead = await pb.collection("users").create({
    email: leadEmail,
    password: tempPassword,
    passwordConfirm: tempPassword,
    name: leadName,
    role: "institution",
  });

  const institution = await pb.collection("institutions").create({
    name: institutionName,
    district,
    code,
    campusLeadId: campusLead.id,
    maxTeams,
    status: "active",
  });

  await pb.collection("users").update(campusLead.id, {
    institutionId: institution.id,
  });

  try {
    await pb.collection("users").requestPasswordReset(leadEmail);
  } catch (err) {
    console.error("[team] campus-lead reset email failed:", err);
  }

  return { ok: true };
}

/** Default team capacity per institution. */
export const DEFAULT_MAX_TEAMS = 5;
