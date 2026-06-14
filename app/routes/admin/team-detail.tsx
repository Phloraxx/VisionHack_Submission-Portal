import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import { validateOrigin } from "~/lib/csrf.server";
import {
  canTransitionTo,
  getValidTransitions,
} from "~/lib/team-status";
import type { TeamStatus, TeamRecord, MemberRecord } from "~/lib/types";
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
  user: any;
  team: TeamRecord & {
    expand?: {
      institutionId?: { name: string; district: string; code: string };
      leaderUserId?: { name: string; email: string };
    };
  };
  members: MemberRecord[];
  questionnaire: any | null;
  validTransitions: TeamStatus[];
  roleContext: RoleContext;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request, params }: LoaderFunctionArgs) {
  const role = detectRole(request.url);
  const { user } = await requireRole(request, [role]);
  const pb = await createSuperuserClient();
  const teamId = params.teamId as string;

  const team = await pb.collection("teams").getOne<
    TeamRecord & {
      expand?: {
        institutionId?: { name: string; district: string; code: string };
        leaderUserId?: { name: string; email: string };
      };
    }
  >(teamId, {
    expand: "institutionId,leaderUserId",
  });

  const members = await pb
    .collection("members")
    .getFullList<MemberRecord>({
      filter: pb.filter('teamId = {:teamId}', { teamId }),
    });

  let questionnaire = null;
  try {
    questionnaire = await pb
      .collection("questionnaire_responses")
      .getFirstListItem(pb.filter('teamId = {:teamId}', { teamId }));
  } catch {
    // no questionnaire response
  }

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

export async function action({ request, params }: ActionFunctionArgs) {
  validateOrigin(request);
  const role = detectRole(request.url);
  const { user } = await requireRole(request, [role]);
  const pb = await createSuperuserClient();
  const teamId = params.teamId as string;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "transition") {
    const toStatus = formData.get("toStatus") as TeamStatus;
    const team = await pb.collection("teams").getOne(teamId);

    if (!canTransitionTo(team.status, toStatus, user.role)) {
      return Response.json({
        success: false,
        error: `Cannot transition from "${team.status}" to "${toStatus}"`,
      });
    }

    await pb.collection("teams").update(teamId, {
      status: toStatus,
      status_changed_at: new Date().toISOString(),
    });

    return Response.json({ success: true, newStatus: toStatus });
  }

  return Response.json({ success: false, error: "Invalid intent" });
}

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
