import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import { validateOrigin } from "~/lib/csrf.server";
import { sendEmail } from "~/lib/email.server";
import { escapeHtml } from "~/lib/utils";
import {
  canTransitionTo,
  getValidTransitions,
  STATUS_LABELS,
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
  const pb = createSuperuserClient();
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
  const pb = createSuperuserClient();
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

    // Send notification email to team lead about status change
    try {
      const updatedTeam = await pb.collection("teams").getOne(teamId, { expand: "leaderUserId" });
      const leadUser = (updatedTeam as any).expand?.leaderUserId;
      if (leadUser?.email) {
        await sendStatusChangeEmail(
          leadUser.email,
          leadUser.name || "Team Lead",
          (updatedTeam as any).name,
          toStatus,
        );
      }
    } catch { /* email failure is non-blocking */ }

    return Response.json({ success: true, newStatus: toStatus });
  }

  if (intent === "save-notes") {
    const notes = formData.get("notes") as string;
    await pb.collection("teams").update(teamId, {
      notes: notes || "",
      reviewed_by: user.name || user.email,
    });
    return Response.json({ success: true });
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

async function sendStatusChangeEmail(
  to: string,
  leadName: string,
  teamName: string,
  newStatus: string,
) {
  const statusLabel = STATUS_LABELS[newStatus as keyof typeof STATUS_LABELS] || newStatus;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h1 style="font-size: 18px; margin: 0 0 16px;">Team Status Update — VisionHack 2026</h1>
      <p>Hello <strong>${escapeHtml(leadName)}</strong>,</p>
      <p>The status of your team <strong>${escapeHtml(teamName)}</strong> has been updated to <strong>${escapeHtml(statusLabel)}</strong>.</p>
      <p style="margin: 16px 0;">
        <a href="https://visionhack.mulearn.org/lead/dashboard"
           style="display: inline-block; background: #18181b; color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 14px;">
          Check Your Dashboard
        </a>
      </p>
      <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" />
      <p style="margin: 0; font-size: 12px; color: #71717a;">VisionHack Team</p>
    </div>
  `.trim();
  await sendEmail({ to, subject: `Team "${teamName}" status: ${statusLabel}`, html });
}
