import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { getLeadTeam } from "~/lib/team.server";
import type {
  TeamView,
  MemberRecord,
  QuestionnaireResponseRecord,
  UserRecord,
} from "~/lib/types";
import TeamDetail from "~/components/shared/team-detail";

export async function loader({ request }: LoaderFunctionArgs) {
  const { pb, user } = await requireRole(request, ["lead"]);

  const team = await getLeadTeam<TeamView>(pb, user.id, {
    expand: "institutionId,leaderUserId",
  });
  if (!team) throw new Response("No team found", { status: 404 });

  const [members, questionnaire] = await Promise.all([
    pb.collection("members").getFullList<MemberRecord>({
      filter: pb.filter("teamId = {:teamId}", { teamId: team.id }),
    }),
    pb
      .collection("questionnaire_responses")
      .getFirstListItem<QuestionnaireResponseRecord>(
        pb.filter("teamId = {:teamId}", { teamId: team.id }),
      )
      .catch(() => null),
  ]);

  return { user, team, members, questionnaire };
}

export function meta() {
  return [{ title: "My Team — VisionHack" }];
}

export default function LeadTeamDetail() {
  const { team, members, questionnaire } =
    useLoaderData() as {
      user: UserRecord;
      team: TeamView;
      members: MemberRecord[];
      questionnaire: QuestionnaireResponseRecord | null;
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
