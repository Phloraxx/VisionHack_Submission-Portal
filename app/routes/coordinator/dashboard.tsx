import { useState, useMemo } from "react";
import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import {
  STATUS_LABELS,
  STATUS_COLORS,
} from "~/lib/team-status";
import type { TeamStatus } from "~/lib/types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Input } from "~/components/ui/input";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Search,
  Building2,
  MapPin,
  Users,
  TrendingUp,
  Filter,
} from "lucide-react";

interface TeamWithExpand {
  id: string;
  name: string;
  teamCode: string;
  status: TeamStatus;
  institutionId: string;
  leaderUserId: string;
  created: string;
  expand?: {
    institutionId?: { name: string; district: string };
    leaderUserId?: { name: string; email: string };
  };
}

interface InstitutionRecord {
  id: string;
  name: string;
  district: string;
  code: string;
  campusLeadId: string;
  maxTeams: number;
  expand?: {
    campusLeadId?: { name: string; email: string };
  };
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireRole(request, ["coordinator"]);
  const pb = createSuperuserClient();

  const teams = await pb.collection("teams").getFullList<TeamWithExpand>({
    expand: "institutionId,leaderUserId",
    sort: "-created",
  });

  const institutions = await pb
    .collection("institutions")
    .getFullList<InstitutionRecord>({
      expand: "campusLeadId",
      sort: "name",
    });

  // Get member counts
  const members = await pb.collection("members").getFullList<{
    teamId: string;
  }>();
  const memberCounts: Record<string, number> = {};
  for (const m of members) {
    memberCounts[m.teamId] = (memberCounts[m.teamId] || 0) + 1;
  }

  return { user, teams, institutions, memberCounts };
}

export function meta() {
  return [{ title: "Coordinator Dashboard — VisionHack" }];
}

export default function CoordinatorDashboard() {
  const { teams, institutions, memberCounts } = useLoaderData() as {
    user: any;
    teams: TeamWithExpand[];
    institutions: InstitutionRecord[];
    memberCounts: Record<string, number>;
  };

  const [searchQuery, setSearchQuery] = useState("");
  const [districtFilter, setDistrictFilter] = useState("all");
  const [institutionFilter, setInstitutionFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [viewMode, setViewMode] = useState<"teams" | "institutions">("teams");

  // Get unique values for filters
  const uniqueDistricts = useMemo(
    () =>
      Array.from(
        new Set(institutions.map((i) => i.district).filter(Boolean)),
      ).sort(),
    [institutions],
  );

  const uniqueStatuses = useMemo(
    () => Array.from(new Set(teams.map((t) => t.status))).sort(),
    [teams],
  );

  // Filter teams
  const filteredTeams = useMemo(() => {
    return teams.filter((team) => {
      const query = searchQuery.toLowerCase();
      const inst = team.expand?.institutionId;

      const matchesSearch =
        team.name.toLowerCase().includes(query) ||
        (inst?.name || "").toLowerCase().includes(query) ||
        (team.expand?.leaderUserId?.name || "")
          .toLowerCase()
          .includes(query) ||
        (team.teamCode || "").toLowerCase().includes(query);

      const matchesDistrict =
        districtFilter === "all" || inst?.district === districtFilter;
      const matchesInstitution =
        institutionFilter === "all" ||
        team.institutionId === institutionFilter;
      const matchesStatus =
        statusFilter === "all" || team.status === statusFilter;

      return (
        matchesSearch && matchesDistrict && matchesInstitution && matchesStatus
      );
    });
  }, [teams, searchQuery, districtFilter, institutionFilter, statusFilter]);

  // Filter institutions
  const filteredInstitutions = useMemo(() => {
    return institutions.filter((inst) => {
      const query = searchQuery.toLowerCase();
      const matchesSearch =
        inst.name.toLowerCase().includes(query) ||
        (inst.expand?.campusLeadId?.name || "")
          .toLowerCase()
          .includes(query);

      const matchesDistrict =
        districtFilter === "all" || inst.district === districtFilter;

      return matchesSearch && matchesDistrict;
    });
  }, [institutions, searchQuery, districtFilter]);

  // Get team counts per institution
  const teamsByInstitution = useMemo(() => {
    const counts: Record<
      string,
      { total: number; registered: number; submitted: number }
    > = {};
    for (const team of teams) {
      if (!counts[team.institutionId]) {
        counts[team.institutionId] = {
          total: 0,
          registered: 0,
          submitted: 0,
        };
      }
      counts[team.institutionId].total++;
      if (team.status === "registered") counts[team.institutionId].registered++;
      if (team.status === "shortlisted") counts[team.institutionId].submitted++;
    }
    return counts;
  }, [teams]);

  const stats = {
    totalTeams: filteredTeams.length,
    totalInstitutions:
      viewMode === "institutions"
        ? filteredInstitutions.length
        : new Set(filteredTeams.map((t) => t.institutionId)).size,
    invited: filteredTeams.filter((t) => t.status === "invited").length,
    registered: filteredTeams.filter((t) => t.status === "registered").length,
    shortlisted: filteredTeams.filter((t) => t.status === "shortlisted").length,
    submitted: filteredTeams.filter((t) => t.status === "submitted")
      .length,
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Coordinator Dashboard
        </h1>
        <p className="mt-1 text-muted-foreground">
          View teams and institutions filtered by district.
        </p>
      </div>

      {/* District Filter */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <div className="flex items-center gap-4">
            <MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
            <Select
              value={districtFilter}
              onValueChange={(val) => {
                setDistrictFilter(val);
                setInstitutionFilter("all");
              }}
            >
              <SelectTrigger className="w-full md:w-64">
                <SelectValue placeholder="Select District" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Districts</SelectItem>
                {uniqueDistricts.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {districtFilter !== "all" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDistrictFilter("all");
                  setInstitutionFilter("all");
                }}
              >
                Clear
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6 mb-6 stagger-cards">
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Total Teams</p>
            <p className="text-xl font-bold">{stats.totalTeams}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Invited</p>
            <p className="text-xl font-bold text-yellow-600">
              {stats.invited}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Registered</p>
            <p className="text-xl font-bold text-blue-600">
              {stats.registered}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Shortlisted</p>
            <p className="text-xl font-bold text-green-600">
              {stats.shortlisted}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Submitted</p>
            <p className="text-xl font-bold text-purple-600">
              {stats.submitted}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 text-center">
            <p className="text-xs text-muted-foreground">Institutions</p>
            <p className="text-xl font-bold">{stats.totalInstitutions}</p>
          </CardContent>
        </Card>
      </div>

      {/* View Mode + Filters */}
      <Card className="mb-6">
        <CardContent className="pt-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">View:</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant={viewMode === "teams" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("teams")}
              >
                <Users className="mr-1.5 h-4 w-4" />
                Teams
              </Button>
              <Button
                variant={viewMode === "institutions" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("institutions")}
              >
                <Building2 className="mr-1.5 h-4 w-4" />
                Institutions
              </Button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={
                  viewMode === "teams"
                    ? "Search teams..."
                    : "Search institutions..."
                }
                className="pl-9"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {viewMode === "teams" && (
              <>
                <Select
                  value={institutionFilter}
                  onValueChange={setInstitutionFilter}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Filter by Institution" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Institutions</SelectItem>
                    {institutions.map((inst) => (
                      <SelectItem key={inst.id} value={inst.id}>
                        {inst.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={statusFilter}
                  onValueChange={setStatusFilter}
                >
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
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Content */}
      {viewMode === "teams" ? (
        filteredTeams.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No teams match your filters
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 stagger-cards">
            {filteredTeams.map((team) => {
              const colors = STATUS_COLORS[team.status];
              const inst = team.expand?.institutionId;
              return (
                <Link
                  key={team.id}
                  to={`/coordinator/teams/${team.id}`}
                  className="block"
                >
                  <Card className="h-full card-hover cursor-pointer">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between mb-2">
                        <Badge
                          className={`${colors.bg} ${colors.text} border-0`}
                        >
                          {STATUS_LABELS[team.status]}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {memberCounts[team.id] || 0} members
                        </span>
                      </div>
                      <CardTitle className="text-sm font-semibold leading-snug">
                        {team.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs space-y-1.5 text-muted-foreground">
                      {inst && (
                        <div className="flex items-center gap-1.5">
                          <Building2 className="h-3 w-3 shrink-0" />
                          <span className="truncate">{inst.name}</span>
                        </div>
                      )}
                      {inst?.district && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3 w-3 shrink-0" />
                          <span>{inst.district}</span>
                        </div>
                      )}
                      {team.teamCode && (
                        <span className="inline-block text-xs font-mono text-blue-600 bg-blue-50 dark:bg-blue-900/30 dark:text-blue-300 px-1.5 py-0.5 rounded">
                          {team.teamCode}
                        </span>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )
      ) : (
        // Institutions view
        filteredInstitutions.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No institutions match your filters
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredInstitutions.map((inst) => {
              const counts = teamsByInstitution[inst.id] || {
                total: 0,
                registered: 0,
                submitted: 0,
              };
              return (
                <Card key={inst.id} className="h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-semibold">
                      {inst.name}
                    </CardTitle>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <MapPin className="h-3 w-3" />
                      {inst.district}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-muted rounded p-2 text-center">
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="text-lg font-bold">{counts.total}</p>
                      </div>
                      <div className="bg-blue-50 dark:bg-blue-900/30 rounded p-2 text-center">
                        <p className="text-xs text-blue-600 dark:text-blue-300">
                          Registered
                        </p>
                        <p className="text-lg font-bold text-blue-600 dark:text-blue-300">
                          {counts.registered}
                        </p>
                      </div>
                      <div className="bg-purple-50 dark:bg-purple-900/30 rounded p-2 text-center">
                        <p className="text-xs text-purple-600 dark:text-purple-300">
                          Submitted
                        </p>
                        <p className="text-lg font-bold text-purple-600 dark:text-purple-300">
                          {counts.submitted}
                        </p>
                      </div>
                    </div>
                    {inst.expand?.campusLeadId && (
                      <div className="text-xs text-muted-foreground border-t pt-2">
                        Lead: {inst.expand.campusLeadId.name} (
                        {inst.expand.campusLeadId.email})
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div>
      <div className="mb-8">
        <Skeleton className="h-7 w-52" />
        <Skeleton className="mt-1 h-4 w-72" />
      </div>

      {/* District filter */}
      <Card className="mb-6">
        <CardContent className="pt-4">
          <Skeleton className="h-10 w-48 rounded-lg" />
        </CardContent>
      </Card>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6 mb-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-4 text-center">
              <Skeleton className="mx-auto h-3 w-16" />
              <Skeleton className="mx-auto mt-1 h-6 w-10" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* View mode + filters */}
      <Card className="mb-6">
        <CardContent className="pt-4 space-y-4">
          <Skeleton className="h-8 w-40" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </div>
        </CardContent>
      </Card>

      {/* Team cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between mb-2">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-3 w-16" />
              </div>
              <Skeleton className="h-5 w-full" />
            </CardHeader>
            <CardContent className="space-y-1.5">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-3 w-24" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
