import { Download } from "lucide-react";
import { useLoaderData } from "react-router";
import { Link } from "react-router";
import TeamDetail from "~/components/shared/team-detail";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { fail, ok, secureAction } from "~/lib/action.server";
import { downloadTeamCSV } from "~/lib/csv-export.client";
import { members, questionnaireResponses, teams } from "~/lib/db.server";
import { secureLoader } from "~/lib/loader.server";
import { transitionTeamSchema } from "~/lib/schemas/institution";
import { ROLE_DASHBOARD_MAP } from "~/lib/team-policy";
import { getValidTransitions } from "~/lib/team-status";
import {
	getInstitutionForUser,
	getLeadTeam,
	notifyStatusChange,
	transitionTeamStatus,
} from "~/lib/team.server";
import type {
	MemberRecord,
	QuestionnaireResponseRecord,
	Role,
	TeamStatus,
	TeamView,
	UserRecord,
} from "~/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoaderData {
	user: UserRecord;
	team: TeamView;
	members: MemberRecord[];
	questionnaire: QuestionnaireResponseRecord | null;
	validTransitions: TeamStatus[];
}

// ---------------------------------------------------------------------------
// Loader — role-aware scoping
// ---------------------------------------------------------------------------

export const loader = secureLoader(
	{ roles: ["admin", "coordinator", "institution", "lead"] },
	async ({ user, params }) => {
		const teamId = params.teamId as string;

		switch (user.role) {
			// Lead — can only access their own team
			case "lead": {
				const team = await getLeadTeam(user);
				// 404 for "not yours" as well: a 403 would confirm the id exists.
				if (!team || team.id !== teamId) throw new Response("Team not found", { status: 404 });

				// Both reads are scoped by the §6.2 predicate: the roster by
				// the parent team's leader, the questionnaire by `user_id`.
				const [membersResult, questionnaire] = await Promise.all([
					members.list(user, { teamId: team.id, perPage: 100 }),
					questionnaireResponses.getByTeam(user, team.id),
				]);

				return {
					user,
					team,
					members: membersResult.items,
					questionnaire,
					validTransitions: [],
				} satisfies LoaderData;
			}

			// Institution — scoped to their own institution's teams
			case "institution": {
				const [institution, team] = await Promise.all([
					getInstitutionForUser(user),
					teams.getOne(user, teamId),
				]);

				if (!institution) throw new Response("Institution not found", { status: 404 });
				if (!team) throw new Response("Team not found", { status: 404 });
				if (team.institutionId !== institution.id) {
					throw new Response("Team not found", { status: 404 });
				}

				const [membersResult, questionnaire] = await Promise.all([
					members.list(user, { teamId, perPage: 100 }),
					questionnaireResponses.getByTeam(user, teamId),
				]);

				const validTransitions = getValidTransitions(team.status, user.role);

				return {
					user,
					team,
					members: membersResult.items,
					questionnaire,
					validTransitions,
				} satisfies LoaderData;
			}

			// Admin & Coordinator — global access, transitions filtered per role
			case "admin":
			case "coordinator": {
				const team = await teams.getOne(user, teamId);
				if (!team) throw new Response("Team not found", { status: 404 });

				const [membersResult, questionnaire] = await Promise.all([
					members.list(user, { teamId, perPage: 100 }),
					questionnaireResponses.getByTeam(user, teamId),
				]);

				const validTransitions = getValidTransitions(team.status, user.role);

				return {
					user,
					team,
					members: membersResult.items,
					questionnaire,
					validTransitions,
				} satisfies LoaderData;
			}

			default:
				throw new Response("Forbidden", { status: 403 });
		}
	},
);

// ---------------------------------------------------------------------------
// Action — role-gated status transitions (lead is read-only)
// ---------------------------------------------------------------------------

export const action = secureAction(
	{ roles: ["admin", "coordinator", "institution"] },
	async ({ formData, user, intent, params }) => {
		const teamId = params.teamId ?? (formData.get("teamId") as string | null) ?? "";

		if (intent === "transition") {
			const parsed = transitionTeamSchema.safeParse({
				teamId,
				toStatus: formData.get("toStatus"),
			});
			if (!parsed.success) {
				return fail({ error: parsed.error.issues[0]?.message ?? "Invalid input.", status: 400 });
			}
			const { toStatus } = parsed.data;

			// Resolve institutionId for the institution IDOR guard.
			let institutionId: string | undefined;
			if (user.role === "institution") {
				const inst = await getInstitutionForUser(user);
				if (!inst) return fail({ error: "Institution not found", status: 404 });
				institutionId = inst.id;
			}

			// Re-fetch team with leader info for the notification email. The
			// repository always populates `expand.leaderUserId` from its join,
			// and scopes the read to the actor (§6.2).
			const team = await teams.getOne(user, teamId);

			const result = await transitionTeamStatus({
				teamId,
				to: toStatus,
				role: user.role,
				institutionId,
				actorUserId: user.id,
			});
			if (!result.ok) return result.response;

			// Best-effort notification: fired, not awaited, so a slow Resend
			// call cannot hold the action response.
			if (team?.expand?.leaderUserId) {
				const lead = team.expand.leaderUserId;
				notifyStatusChange({
					to: lead.email,
					leadName: lead.name || "Team Lead",
					teamName: team.name,
					status: toStatus,
				});
			}

			return ok({ newStatus: toStatus });
		}

		return fail({ error: "Invalid intent", status: 400 });
	},
);

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export function meta() {
	return [{ title: "Team Detail — VisionHack" }];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function TeamDetailPage() {
	const { user, team, members, questionnaire, validTransitions } = useLoaderData() as LoaderData;

	// Admin navigates back to the team list; every other role returns to their dashboard.
	const backUrl = user.role === "admin" ? "/admin/teams" : ROLE_DASHBOARD_MAP[user.role];
	const backLabel = user.role === "admin" ? "Back to Teams" : "Back to Dashboard";

	return (
		<TeamDetail
			team={team}
			members={members}
			questionnaire={questionnaire}
			validTransitions={validTransitions}
			backUrl={backUrl}
			backLabel={backLabel}
			exportCard={buildExportCard(user.role, team, members, questionnaire)}
		/>
	);
}

function buildExportCard(
	role: Role,
	team: TeamView,
	members: MemberRecord[],
	questionnaire: QuestionnaireResponseRecord | null,
): React.ReactNode {
	// Lead has no export card
	if (role === "lead") return undefined;

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">Export</CardTitle>
				<CardDescription>
					{role === "admin"
						? "All teams can be exported from the export page"
						: "Download all details as CSV"}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{role === "admin" ? (
					<Button variant="outline" size="sm" className="w-full" asChild>
						<Link to="/admin/export">
							<Download className="mr-1.5 h-4 w-4" />
							Export All Teams CSV
						</Link>
					</Button>
				) : (
					<Button
						variant="outline"
						size="sm"
						className="w-full"
						onClick={() => downloadTeamCSV(team, members, questionnaire)}
					>
						<Download className="mr-1.5 h-4 w-4" />
						Download Team CSV
					</Button>
				)}
			</CardContent>
		</Card>
	);
}
