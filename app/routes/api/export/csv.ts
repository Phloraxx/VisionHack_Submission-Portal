/**
 * CSV Export API — returns downloadable CSV of teams and members.
 * GET /api/export/csv?filterStatus=all
 */
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import { STATUS_LABELS } from "~/lib/team-status";
import type { TeamStatus, TeamRecord } from "~/lib/types";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireRole(request, ["admin"]);

  const url = new URL(request.url);
  const filterStatus = url.searchParams.get("filterStatus") || "all";

  const pb = createSuperuserClient();

  const teams = await pb.collection("teams").getFullList<TeamRecord & {
    expand?: {
      institutionId?: { name: string; district: string };
      leaderUserId?: { name: string; email: string };
    };
  }>({
    expand: "institutionId,leaderUserId",
    sort: "-created",
  });

  const filtered = filterStatus !== "all"
    ? teams.filter((t) => t.status === filterStatus)
    : teams;

  const members = await pb.collection("members").getFullList<{
    teamId: string;
    fullName: string;
    email: string;
    phone: string;
    gender: string;
    role: string;
  }>();

  const membersByTeam: Record<string, any[]> = {};
  for (const m of members) {
    if (!membersByTeam[m.teamId]) membersByTeam[m.teamId] = [];
    membersByTeam[m.teamId].push(m);
  }

  const escapeCsv = (str: string) => {
    if (!str) return "";
    const text = String(str).replace(/"/g, '""');
    return text.includes(",") || text.includes('"') || text.includes("\n")
      ? `"${text}"`
      : text;
  };

  const headers = [
    "Team Name", "Team Code", "Status", "Institution", "District",
    "Team Lead Name", "Team Lead Email",
    "Idea Title", "Idea Description", "Idea Tech Stack", "Submission File",
    "Created At", "Member Count",
    "Member 1 Name", "Member 1 Email", "Member 1 Phone", "Member 1 Gender", "Member 1 Role",
    "Member 2 Name", "Member 2 Email", "Member 2 Phone", "Member 2 Gender", "Member 2 Role",
    "Member 3 Name", "Member 3 Email", "Member 3 Phone", "Member 3 Gender", "Member 3 Role",
    "Member 4 Name", "Member 4 Email", "Member 4 Phone", "Member 4 Gender", "Member 4 Role",
    "Member 5 Name", "Member 5 Email", "Member 5 Phone", "Member 5 Gender", "Member 5 Role",
  ];

  const rows = filtered.map((team) => {
    const inst = team.expand?.institutionId;
    const leader = team.expand?.leaderUserId;
    const teamMembers = membersByTeam[team.id] || [];

    const row = [
      escapeCsv(team.name),
      escapeCsv(team.teamCode || ""),
      escapeCsv(STATUS_LABELS[team.status] || team.status),
      escapeCsv(inst?.name || ""),
      escapeCsv(inst?.district || ""),
      escapeCsv(leader?.name || ""),
      escapeCsv(leader?.email || ""),
      escapeCsv(team.idea_title || ""),
      escapeCsv(team.idea_desc || ""),
      escapeCsv(team.idea_tech_stack || ""),
      escapeCsv(team.submission_file || ""),
      escapeCsv(team.created || ""),
      String(teamMembers.length),
    ];

    for (let i = 0; i < 5; i++) {
      const m = teamMembers[i];
      row.push(
        escapeCsv(m?.fullName || ""),
        escapeCsv(m?.email || ""),
        escapeCsv(m?.phone || ""),
        escapeCsv(m?.gender || ""),
        escapeCsv(m?.role || ""),
      );
    }
    return row.join(",");
  });

  const csv = "\uFEFF" + [headers.join(","), ...rows].join("\n");

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="teams_export_${new Date().toISOString().split("T")[0]}.csv"`,
    },
  });
}
