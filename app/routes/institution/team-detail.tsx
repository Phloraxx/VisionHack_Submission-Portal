/**
 * Institution Team Detail — scoped to the institution's own teams.
 * Reuses the shared TeamDetail component with institution-specific
 * data fetching and transition filtering.
 */
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { secureAction, fail, ok } from "~/lib/action.server";
import {
  getInstitutionForUser,
  transitionTeamStatus,
  sendStatusChangeEmail,
} from "~/lib/team.server";
import { getValidTransitions } from "~/lib/team-status";
import type {
  TeamStatus,
  TeamView,
  MemberRecord,
  QuestionnaireResponseRecord,
  UserRecord,
} from "~/lib/types";
import TeamDetail, { downloadTeamCSV } from "~/components/shared/team-detail";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Download } from "lucide-react";

interface LoaderData {
  user: UserRecord;
  team: TeamView;
  members: MemberRecord[];
  questionnaire: QuestionnaireResponseRecord | null;
  validTransitions: TeamStatus[];
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { pb, user } = await requireRole(request, ["institution"]);
  const teamId = params.teamId as string;

  // Institution + team are independent reads — run in parallel.
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
    pb.collection("members").getFullList<MemberRecord>({
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

  return { user, team, members, questionnaire, validTransitions } satisfies LoaderData;
}

export const action = secureAction(
  { roles: ["institution"] },
  async ({ formData, user, pb, intent, params }) => {
    const teamId = params.teamId ?? (formData.get("teamId") as string | null) ?? "";

    const institution = await getInstitutionForUser(pb, user.id, { fields: "id" });
    if (!institution) return fail({ error: "Institution not found", status: 404 });
    if (intent === "transition") {
      const toStatus = formData.get("toStatus") as TeamStatus;

      // Re-fetch team with leader info for the notification email.
      const team = await pb
        .collection("teams")
        .getOne(teamId, { expand: "leaderUserId", fields: "id,name,leaderUserId,expand.leaderUserId.email,expand.leaderUserId.name" })
        .catch(() => null);

      const result = await transitionTeamStatus(pb, {
        teamId,
        to: toStatus,
        role: user.role,
        institutionId: institution.id,
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

export function meta() {
  return [{ title: "Team Detail — VisionHack" }];
}

export default function InstitutionTeamDetail() {
  const { team, members, questionnaire, validTransitions } =
    useLoaderData() as LoaderData;

  return (
    <TeamDetail
      team={team}
      members={members}
      questionnaire={questionnaire}
      validTransitions={validTransitions}
      backUrl="/institution/dashboard"
      backLabel="Back to Dashboard"
      exportCard={
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Export</CardTitle>
            <CardDescription>Download team details as CSV</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => downloadTeamCSV(team, members, questionnaire)}
            >
              <Download className="mr-1.5 h-4 w-4" />
              Download Team CSV
            </Button>
          </CardContent>
        </Card>
      }
    />
  );
}
