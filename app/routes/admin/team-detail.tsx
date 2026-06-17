import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import { secureAction, fail, ok } from "~/lib/action.server";
import {
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Download } from "lucide-react";
import TeamDetail, { downloadTeamCSV } from "~/components/shared/team-detail";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RoleContext = "admin" | "coordinator";

function detectRole(url: string): RoleContext {
  return url.includes("/admin/") ? "admin" : "coordinator";
}

interface LoaderData {
  user: UserRecord;
  team: TeamView;
  members: MemberRecord[];
  questionnaire: QuestionnaireResponseRecord | null;
  validTransitions: TeamStatus[];
  roleContext: RoleContext;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, params }: LoaderFunctionArgs) {
  const role = detectRole(request.url);
  const { user } = await requireRole(request, [role]);
  const pb = createSuperuserClient();
  const teamId = params.teamId as string;

  // Team, members, and questionnaire are independent reads — run together.
  const [team, members, questionnaire] = await Promise.all([
    pb.collection("teams").getOne<TeamView>(teamId, {
      expand: "institutionId,leaderUserId",
    }),
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

  return {
    user,
    team,
    members,
    questionnaire,
    validTransitions,
    roleContext: role,
  } satisfies LoaderData;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = secureAction(
  { roles: ["admin", "coordinator"] },
  async ({ formData, user, intent, params }) => {
    const teamId =
      params.teamId ?? (formData.get("teamId") as string | null) ?? "";

    // Superuser is required here: the `teams` updateRule grants write to
    // admin / institution / lead but NOT coordinator, and this route is
    // shared by coordinators who legitimately transition status.
    const pb = createSuperuserClient();

    if (intent === "transition") {
      const toStatus = formData.get("toStatus") as TeamStatus;

      // Fetch with the lead expand up front so we can reuse it for the
      // notification email — no second round-trip.
      let team: TeamView;
      try {
        team = await pb
          .collection("teams")
          .getOne<TeamView>(teamId, { expand: "leaderUserId" });
      } catch {
        return fail({ error: "Team not found", status: 404 });
      }

      const result = await transitionTeamStatus(pb, {
        teamId,
        to: toStatus,
        role: user.role,
      });
      if (!result.ok) return result.response;

      // Best-effort notification email — reuse the expand from above.
      const leadUser = team.expand?.leaderUserId;
      if (leadUser?.email) {
        try {
          await sendStatusChangeEmail({
            to: leadUser.email,
            leadName: leadUser.name || "Team Lead",
            teamName: team.name,
            status: toStatus,
          });
        } catch (err) {
          console.error("[admin/team-detail] notify email failed:", err);
        }
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
  const { team, members, questionnaire, validTransitions, roleContext } =
    useLoaderData() as LoaderData;

  return (
    <TeamDetail
      team={team}
      members={members}
      questionnaire={questionnaire}
      validTransitions={validTransitions}
      backUrl={roleContext === "admin" ? "/admin/teams" : "/coordinator/dashboard"}
      backLabel={roleContext === "admin" ? "Back to Teams" : "Back to Dashboard"}
      exportCard={
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Export</CardTitle>
            {roleContext === "coordinator" && (
              <CardDescription>Download all details as CSV</CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {roleContext === "admin" ? (
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
      }
    />
  );
}
