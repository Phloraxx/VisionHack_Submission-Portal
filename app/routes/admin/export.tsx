import { useState } from "react";
import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
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
          <a
            href={`/api/export/csv?filterStatus=${statusFilter}`}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors w-full sm:w-auto"
          >
            <Download className="h-5 w-5" />
            Download CSV ({filteredTeams.length} teams, {filteredMemberCount}{" "}
            members)
          </a>

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
