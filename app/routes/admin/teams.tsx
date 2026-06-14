import { useState, useMemo } from "react";
import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import {
  STATUS_LABELS,
  STATUS_COLORS,
} from "~/lib/team-status";
import type { TeamStatus, MemberRecord } from "~/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Button } from "~/components/ui/button";
import { Search, ExternalLink, Users, CalendarIcon } from "lucide-react";

interface TeamWithExpand {
  id: string;
  name: string;
  teamCode: string;
  status: TeamStatus;
  created: string;
  institutionId: string;
  leaderUserId: string;
  expand?: {
    institutionId?: { name: string; district: string };
    leaderUserId?: { name: string; email: string };
  };
}

interface MemberCountRecord {
  teamId: string;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireRole(request, ["admin"]);
  const pb = await createSuperuserClient();

  const teams = await pb.collection("teams").getFullList<TeamWithExpand>({
    expand: "institutionId,leaderUserId",
    sort: "-created",
  });

  // Get member counts
  const members = await pb.collection("members").getFullList<MemberCountRecord>();
  const memberCounts: Record<string, number> = {};
  for (const m of members) {
    memberCounts[m.teamId] = (memberCounts[m.teamId] || 0) + 1;
  }

  return { user, teams, memberCounts };
}

export function meta() {
  return [{ title: "All Teams — VisionHack" }];
}

export default function AdminTeams() {
  const { teams, memberCounts } = useLoaderData() as {
    user: any;
    teams: TeamWithExpand[];
    memberCounts: Record<string, number>;
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredTeams = useMemo(() => {
    return teams.filter((team) => {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        team.name.toLowerCase().includes(query) ||
        (team.teamCode || "").toLowerCase().includes(query) ||
        (team.expand?.institutionId?.name || "")
          .toLowerCase()
          .includes(query) ||
        (team.expand?.leaderUserId?.name || "")
          .toLowerCase()
          .includes(query) ||
        (team.expand?.leaderUserId?.email || "")
          .toLowerCase()
          .includes(query);

      const matchesStatus =
        statusFilter === "all" || team.status === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [teams, searchQuery, statusFilter]);

  const uniqueStatuses = Array.from(new Set(teams.map((t) => t.status))).sort();

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">All Teams</h1>
        <p className="mt-1 text-muted-foreground">
          View, search, and manage all registered teams ({teams.length} total)
        </p>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">Total Teams</p>
            <p className="text-2xl font-bold">{teams.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">Registered</p>
            <p className="text-2xl font-bold text-blue-600">
              {teams.filter((t) => t.status === "registered").length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">Shortlisted</p>
            <p className="text-2xl font-bold text-indigo-600">
              {
                teams.filter((t) => t.status === "shortlisted")
                  .length
              }
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-sm text-muted-foreground">Submitted</p>
            <p className="text-2xl font-bold text-purple-600">
              {teams.filter((t) => t.status === "submitted").length}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Search & Filters */}
      <Card className="mb-6">
        <CardContent className="pt-4">
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
              {searchQuery || statusFilter !== "all" ? (
                <span>
                  Showing {filteredTeams.length} of {teams.length} teams
                </span>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Teams List */}
      <div className="space-y-3">
        {filteredTeams.map((team) => {
          const colors = STATUS_COLORS[team.status];
          return (
            <Link
              key={team.id}
              to={`/admin/teams/${team.id}`}
              className="block"
            >
              <Card className="transition-shadow hover:shadow-md cursor-pointer">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <p className="font-medium truncate">{team.name}</p>
                        {team.teamCode && (
                          <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                            {team.teamCode}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
                        {team.expand?.institutionId && (
                          <span>
                            {team.expand.institutionId.name}
                            {team.expand.institutionId.district
                              ? ` • ${team.expand.institutionId.district}`
                              : ""}
                          </span>
                        )}
                        {team.expand?.leaderUserId && (
                          <span>
                            Lead: {team.expand.leaderUserId.name}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          {memberCounts[team.id] || 0}
                        </span>
                        <span className="flex items-center gap-1">
                          <CalendarIcon className="h-3 w-3" />
                          {new Date(team.created).toLocaleDateString()}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0 ml-4">
                      <Badge
                        className={`${colors.bg} ${colors.text} border-0`}
                      >
                        {STATUS_LABELS[team.status] || team.status}
                      </Badge>
                      <ExternalLink className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}

        {filteredTeams.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No teams found
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
