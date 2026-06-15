import { useState } from "react";
import { useLoaderData, Form } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import { validateOrigin } from "~/lib/csrf.server";
import {
  STATUS_LABELS,
  STATUS_COLORS,
} from "~/lib/team-status";
import type { TeamStatus, TeamRecord } from "~/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Search, Download, FileDown } from "lucide-react";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

// TeamExport: central TeamRecord + expansion for institution/leader names
interface TeamExport extends TeamRecord {
  expand?: {
    institutionId?: { name: string; district: string };
    leaderUserId?: { name: string; email: string };
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireRole(request, ["admin"]);
  const pb = createSuperuserClient();

  const teams = await pb
    .collection("teams")
    .getFullList<TeamExport>({
      expand: "institutionId,leaderUserId",
      sort: "-created",
    });

  // Get members for all teams
  const members = await pb.collection("members").getFullList<{
    id: string;
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

  const memberCounts: Record<string, number> = {};
  for (const m of members) {
    memberCounts[m.teamId] = (memberCounts[m.teamId] || 0) + 1;
  }

  const totalMembers = members.length;

  return {
    user,
    teams,
    membersByTeam,
    memberCounts,
    totalMembers,
  };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  validateOrigin(request);
  await requireRole(request, ["admin"]);
  const pb = createSuperuserClient();

  const formData = await request.formData();
  const filterStatus = formData.get("filterStatus") as string;

  let teams = await pb
    .collection("teams")
    .getFullList<TeamExport>({
      expand: "institutionId,leaderUserId",
      sort: "-created",
    });

  if (filterStatus && filterStatus !== "all") {
    teams = teams.filter((t) => t.status === filterStatus);
  }

  // Get members
  const allMembers = await pb.collection("members").getFullList<{
    teamId: string;
    fullName: string;
    email: string;
    phone: string;
    gender: string;
    role: string;
  }>();

  const membersByTeam: Record<string, any[]> = {};
  for (const m of allMembers) {
    if (!membersByTeam[m.teamId]) membersByTeam[m.teamId] = [];
    membersByTeam[m.teamId].push(m);
  }

  // Build CSV
  const headers = [
    "Team Name",
    "Team Code",
    "Status",
    "Institution",
    "District",
    "Team Lead Name",
    "Team Lead Email",
    "Idea Title",
    "Idea Description",
    "Idea Tech Stack",
    "Submission File",
    "Created At",
    "Member Count",
    "Member 1 Name",
    "Member 1 Email",
    "Member 1 Phone",
    "Member 1 Gender",
    "Member 1 Role",
    "Member 2 Name",
    "Member 2 Email",
    "Member 2 Phone",
    "Member 2 Gender",
    "Member 2 Role",
    "Member 3 Name",
    "Member 3 Email",
    "Member 3 Phone",
    "Member 3 Gender",
    "Member 3 Role",
    "Member 4 Name",
    "Member 4 Email",
    "Member 4 Phone",
    "Member 4 Gender",
    "Member 4 Role",
    "Member 5 Name",
    "Member 5 Email",
    "Member 5 Phone",
    "Member 5 Gender",
    "Member 5 Role",
  ];

  const rows = teams.map((team) => {
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

function escapeCsv(str: string): string {
  if (!str) return "";
  const text = String(str).replace(/"/g, '""');
  return text.includes(",") || text.includes('"') || text.includes("\n")
    ? `"${text}"`
    : text;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function meta() {
  return [{ title: "Export Data — VisionHack" }];
}

export default function AdminExport() {
  const { teams, memberCounts, totalMembers } = useLoaderData() as {
    user: any;
    teams: TeamExport[];
    membersByTeam: Record<string, any[]>;
    memberCounts: Record<string, number>;
    totalMembers: number;
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredTeams = teams.filter((team) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      team.name.toLowerCase().includes(query) ||
      (team.teamCode || "").toLowerCase().includes(query) ||
      (team.expand?.institutionId?.name || "")
        .toLowerCase()
        .includes(query) ||
      (team.expand?.leaderUserId?.name || "").toLowerCase().includes(query);
    const matchesStatus =
      statusFilter === "all" || team.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const filteredMemberCount = filteredTeams.reduce(
    (sum, t) => sum + (memberCounts[t.id] || 0),
    0,
  );

  const uniqueStatuses = Array.from(new Set(teams.map((t) => t.status))).sort();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Export Data</h1>
        <p className="mt-1 text-muted-foreground">
          Export filtered teams and members data as CSV.
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">Total Teams</p>
            <p className="text-2xl font-bold">{teams.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">Filtered Teams</p>
            <p className="text-2xl font-bold text-blue-600">
              {filteredTeams.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">Total Members</p>
            <p className="text-2xl font-bold">{totalMembers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">Filtered Members</p>
            <p className="text-2xl font-bold text-blue-600">
              {filteredMemberCount}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Search className="h-4 w-4" />
            Filter Data
          </CardTitle>
          <CardDescription>
            Apply filters to narrow down the teams you want to export
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search teams..."
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {uniqueStatuses.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_LABELS[status as TeamStatus] || status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="text-sm text-muted-foreground flex items-center">
              {filteredTeams.length} of {teams.length} teams
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Download */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileDown className="h-4 w-4" />
            Download CSV
          </CardTitle>
          <CardDescription>
            The export includes team info, institution, lead, and up to 5
            members per team.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post">
            <input type="hidden" name="filterStatus" value={statusFilter} />
            <Button
              type="submit"
              size="lg"
              disabled={filteredTeams.length === 0}
              className="w-full sm:w-auto"
            >
              <Download className="mr-2 h-5 w-5" />
              Download CSV ({filteredTeams.length} teams, {filteredMemberCount}{" "}
              members)
            </Button>
          </Form>

          {filteredTeams.length === 0 && (
            <p className="text-sm text-muted-foreground mt-2">
              No teams match your current filters. Adjust filters to export
              data.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
