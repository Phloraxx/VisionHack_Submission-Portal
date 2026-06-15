/**
 * Institution Team Detail — scoped to the institution's own teams.
 * Reuses the shared TeamDetail component with institution-specific
 * data fetching and transition filtering.
 */
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { validateOrigin } from "~/lib/csrf.server";
import { sendEmail } from "~/lib/email.server";
import { escapeHtml } from "~/lib/utils";
import {
  canTransitionTo,
  getValidTransitions,
  STATUS_LABELS,
} from "~/lib/team-status";
import type { TeamStatus, TeamRecord, MemberRecord, InstitutionRecord } from "~/lib/types";
import TeamDetail, { downloadTeamCSV } from "~/components/shared/team-detail";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Download } from "lucide-react";

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
}

export async function loader({ request, params }: LoaderFunctionArgs) {
  const { pb, user } = await requireRole(request, ["institution"]);
  const teamId = params.teamId as string;

  // Verify this team belongs to the user's institution
  const institutions = await pb
    .collection("institutions")
    .getFullList<InstitutionRecord>();
  const institution = institutions.find((inst) => inst.campusLeadId === user.id);
  if (!institution) {
    throw new Response("Institution not found", { status: 404 });
  }

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

  // Ensure the team belongs to this institution
  if (team.institutionId !== institution.id) {
    throw new Response("Team not found", { status: 404 });
  }

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

  return { user, team, members, questionnaire, validTransitions } satisfies LoaderData;
}

export async function action({ request, params }: ActionFunctionArgs) {
  validateOrigin(request);
  const { pb, user } = await requireRole(request, ["institution"]);
  const teamId = params.teamId as string;

  // Verify this team belongs to the user's institution
  const institutions = await pb
    .collection("institutions")
    .getFullList<InstitutionRecord>();
  const institution = institutions.find((inst) => inst.campusLeadId === user.id);
  if (!institution) {
    return Response.json({ error: "Institution not found" }, { status: 404 });
  }

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "transition") {
    const toStatus = formData.get("toStatus") as TeamStatus;
    const team = await pb.collection("teams").getOne(teamId);

    if (team.institutionId !== institution.id) {
      return Response.json({ error: "Team not found" }, { status: 404 });
    }

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

    // Send notification email
    try {
      const updatedTeam = await pb.collection("teams").getOne(teamId, { expand: "leaderUserId" });
      const leadUser = (updatedTeam as any).expand?.leaderUserId;
      if (leadUser?.email) {
        const statusLabel = STATUS_LABELS[toStatus as keyof typeof STATUS_LABELS] || toStatus;
        const html = `<div style=\"font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px\"><h1>Team Status Update</h1><p>Your team <strong>${escapeHtml((updatedTeam as any).name)}</strong> is now <strong>${escapeHtml(statusLabel)}</strong>.</p><p><a href=\"https://visionhack.mulearn.org/lead/dashboard\">Check your dashboard</a></p></div>`;
        await sendEmail({ to: leadUser.email, subject: `Team status: ${statusLabel}`, html });
      }
    } catch { /* email failure non-blocking */ }

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
