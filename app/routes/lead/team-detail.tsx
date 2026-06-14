import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import type { TeamRecord, MemberRecord } from "~/lib/types";
import TeamDetail from "~/components/shared/team-detail";

export async function loader({ request }: LoaderFunctionArgs) {
  const { pb, user } = await requireRole(request, ["lead"]);

  // Get the team — only the lead's own team
  const teams = await pb
    .collection("teams")
    .getFullList<TeamRecord>({
      filter: pb.filter('leaderUserId = {:userId}', { userId: user.id }),
    });

  if (teams.length === 0) {
    throw new Response("No team found", { status: 404 });
  }

  const team = teams[0];

  const members = await pb
    .collection("members")
    .getFullList<MemberRecord>({
      filter: pb.filter('teamId = {:teamId}', { teamId: team.id }),
    });

  let questionnaire = null;
  try {
    questionnaire = await pb
      .collection("questionnaire_responses")
      .getFirstListItem(pb.filter('teamId = {:teamId}', { teamId: team.id }));
  } catch {
    // no response
  }

  return {
    user,
    team,
    members,
    questionnaire,
  };
}

export function meta() {
  return [{ title: "My Team — VisionHack" }];
}

export default function LeadTeamDetail() {
  const { team, members, questionnaire } =
    useLoaderData() as {
      user: any;
      team: TeamRecord & {
        expand?: {
          institutionId?: { name: string; district: string; code: string };
          leaderUserId?: { name: string; email: string };
        };
      };
      members: MemberRecord[];
      questionnaire: any | null;
    };

  // Read-only — no status transitions for leads viewing their own team
  return (
    <TeamDetail
      team={team}
      members={members}
      questionnaire={questionnaire}
      validTransitions={[]}
      backUrl="/lead/dashboard"
      backLabel="Back to Dashboard"
    />
  );
}
