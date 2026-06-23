import { Download } from "lucide-react";
import { useLoaderData } from "react-router";
import { Link } from "react-router";
import TeamDetail, { downloadTeamCSV } from "~/components/shared/team-detail";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { fail, ok, secureAction } from "~/lib/action.server";
import { secureLoader } from "~/lib/loader.server";
import { getValidTransitions } from "~/lib/team-status";
import {
	getInstitutionForUser,
	getLeadTeam,
	sendStatusChangeEmail,
	transitionTeamStatus,
} from "~/lib/team.server";
import type {
	MemberRecord,
	QuestionnaireResponseRecord,
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
	async ({ pb, user, params }) => {
		const teamId = params.teamId as string;

		switch (user.role) {
			// Lead — can only access their own team
			case "lead": {
				const team = await getLeadTeam<TeamView>(pb, user.id, {
					expand: "institutionId,leaderUserId",
				});
				if (!team) throw new Response("No team found", { status: 404 });
				if (team.id !== teamId) throw new Response("Forbidden", { status: 403 });

				const [members, questionnaire] = await Promise.all([
					pb.collection("members").getList<MemberRecord>(1, 100, {
						filter: pb.filter("teamId = {:teamId}", { teamId: team.id }),
					}),
					pb
						.collection("questionnaire_responses")
						.getFirstListItem<QuestionnaireResponseRecord>(
							pb.filter("teamId = {:teamId}", { teamId: team.id }),
						)
						.catch(() => null),
				]);

				return {
					user,
					team,
					members: members.items,
					questionnaire,
					validTransitions: [],
				} satisfies LoaderData;
			}

			// Institution — scoped to their own institution's teams
			case "institution": {
				const [institution, team] = await Promise.all([
					getInstitutionForUser(pb, user.id, { fields: "id" }),
					pb.collection("teams").getOne<TeamView>(teamId, {
						expand: "institutionId,leaderUserId",
					}),
				]);

				if (!institution) throw new Response("Institution not found", { status: 404 });
				if (team.institutionId !== institution.id) {
					throw new Response("Team not found", { status: 404 });
				}

				const [members, questionnaire] = await Promise.all([
					pb.collection("members").getList<MemberRecord>(1, 100, {
						filter: pb.filter("teamId = {:teamId}", { teamId }),
					}),
					pb
						.collection("questionnaire_responses")
						.getFirstListItem<QuestionnaireResponseRecord>(
							pb.filter("teamId = {:teamId}", { teamId }),
						)
						.catch(() => null),
				]);

				const validTransitions = getValidTransitions(team.status, user.role);

				return {
					user,
					team,
					members: members.items,
					questionnaire,
					validTransitions,
				} satisfies LoaderData;
			}

			// Admin & Coordinator — global access, transitions filtered per role
			case "admin":
			case "coordinator": {
				const team = await pb.collection("teams").getOne<TeamView>(teamId, {
					expand: "institutionId,leaderUserId",
				});

				const [members, questionnaire] = await Promise.all([
					pb.collection("members").getList<MemberRecord>(1, 100, {
						filter: pb.filter("teamId = {:teamId}", { teamId }),
					}),
					pb
						.collection("questionnaire_responses")
						.getFirstListItem<QuestionnaireResponseRecord>(
							pb.filter("teamId = {:teamId}", { teamId }),
						)
						.catch(() => null),
				]);

				const validTransitions = getValidTransitions(team.status, user.role);

				return {
					user,
					team,
					members: members.items,
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
	async ({ formData, user, pb, intent, params }) => {
		const teamId = params.teamId ?? (formData.get("teamId") as string | null) ?? "";

		if (intent === "transition") {
			const toStatus = formData.get("toStatus") as TeamStatus;
			const VALID_TRANSITION_STATUSES = [
				"shortlisted",
				"selected",
				"rejected",
				"withdrawn",
			] as const;
			if (
				!VALID_TRANSITION_STATUSES.includes(toStatus as (typeof VALID_TRANSITION_STATUSES)[number])
			) {
				return fail({ error: "Invalid target status", status: 400 });
			}
			// Coordinator now has write access via PB updateRule — use their own client.
			const actionPb = pb;

			// Resolve institutionId for the institution IDOR guard.
			let institutionId: string | undefined;
			if (user.role === "institution") {
				const inst = await getInstitutionForUser(pb, user.id, {
					fields: "id",
				});
				if (!inst) return fail({ error: "Institution not found", status: 404 });
				institutionId = inst.id;
			}

			// Re-fetch team with leader info for the notification email.
			const team = await actionPb
				.collection("teams")
				.getOne(teamId, {
					expand: "leaderUserId",
					fields: "id,name,leaderUserId,expand.leaderUserId.email,expand.leaderUserId.name",
				})
				.catch(() => null);

			const result = await transitionTeamStatus(actionPb, {
				teamId,
				to: toStatus,
				role: user.role,
				institutionId,
				actorUserId: user.id,
			});
			if (!result.ok) return result.response;

			// Send notification email best-effort.
			if (team?.expand?.leaderUserId) {
				const lead = team.expand.leaderUserId;
				sendStatusChangeEmail({
					to: lead.email,
					leadName: lead.name || "Team Lead",
					teamName: team.name,
					status: toStatus,
				}).catch(() => {}); // Already handled inside function
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

	const backConfig: Record<string, { url: string; label: string }> = {
		admin: { url: "/admin/teams", label: "Back to Teams" },
		coordinator: { url: "/coordinator/dashboard", label: "Back to Dashboard" },
		institution: { url: "/institution/dashboard", label: "Back to Dashboard" },
		lead: { url: "/lead/dashboard", label: "Back to Dashboard" },
	};

	const { url: backUrl, label: backLabel } = backConfig[user.role] ?? backConfig.admin;

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
	role: string,
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
