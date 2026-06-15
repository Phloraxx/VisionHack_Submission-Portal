import { useLoaderData, Link } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import { STATUS_LABELS, STATUS_COLORS } from "~/lib/team-status";
import type { TeamStatus } from "~/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import {
  Users,
  Building2,
  Settings,
  Download,
  University,
  ArrowRight,
  TrendingUp,
} from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireRole(request, ["admin"]);
  const pb = createSuperuserClient();

  const teams = await pb.collection("teams").getFullList<{
    id: string;
    status: TeamStatus;
  }>();
  const institutions = await pb.collection("institutions").getFullList();
  const users = await pb.collection("users").getFullList();

  const statusCounts: Record<string, number> = {};
  for (const team of teams) {
    statusCounts[team.status] = (statusCounts[team.status] || 0) + 1;
  }

  return {
    user,
    totalTeams: teams.length,
    totalInstitutions: institutions.length,
    totalUsers: users.length,
    statusCounts,
  };
}

export function meta() {
  return [{ title: "Admin Dashboard — VisionHack" }];
}

export default function AdminDashboard() {
  const { totalTeams, totalInstitutions, totalUsers, statusCounts } =
    useLoaderData() as {
      user: any;
      totalTeams: number;
      totalInstitutions: number;
      totalUsers: number;
      statusCounts: Record<string, number>;
    };

  const statusEntries = (Object.entries(STATUS_LABELS) as [TeamStatus, string][])
    .filter(([status]) => (statusCounts[status] || 0) > 0);

  const quickActions = [
    {
      label: "Campus Leads",
      href: "/admin/campus-leads",
      icon: University,
      desc: `Manage ${totalInstitutions} institutions`,
    },
    {
      label: "Event Config",
      href: "/admin/config",
      icon: Settings,
      desc: "Toggle registration, questionnaire, nomination, submissions",
    },
    {
      label: "All Teams",
      href: "/admin/teams",
      icon: Users,
      desc: `View and manage ${totalTeams} teams`,
    },
    {
      label: "Export Data",
      href: "/admin/export",
      icon: Download,
      desc: "Download team and member data as CSV",
    },
  ];

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Admin Dashboard
        </h1>
        <p className="mt-1 text-muted-foreground">
          Overview and management for the VisionHack event.
        </p>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8 stagger-cards">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Teams</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalTeams}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Across {totalInstitutions} institutions
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Institutions</CardTitle>
            <Building2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalInstitutions}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {(totalInstitutions > 0
                ? (totalTeams / totalInstitutions).toFixed(1)
                : "0")}{" "}
              avg teams / institution
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{totalUsers}</p>
            <p className="text-xs text-muted-foreground mt-1">
              Leads, institution heads & admins
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Pipeline</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">
              {statusEntries.length}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Active status phases
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Status Distribution Bar */}
      {totalTeams > 0 && (
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-base">Team Pipeline</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Stacked horizontal bar */}
            <div className="flex h-8 w-full overflow-hidden rounded-lg">
              {statusEntries.map(([status, label]) => {
                const count = statusCounts[status] || 0;
                const pct = (count / totalTeams) * 100;
                if (pct < 1) return null;
                const colors = STATUS_COLORS[status];
                return (
                  <div
                    key={status}
                    className={`${colors.dot} flex items-center justify-center text-[10px] font-bold text-white transition-all`}
                    style={{ width: `${pct}%`, minWidth: pct > 5 ? "2rem" : undefined }}
                    title={`${label}: ${count} (${pct.toFixed(1)}%)`}
                  >
                    {pct > 8 ? count : ""}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-3">
              {statusEntries.map(([status, label]) => {
                const colors = STATUS_COLORS[status];
                const count = statusCounts[status] || 0;
                const pct = totalTeams > 0
                  ? ((count / totalTeams) * 100).toFixed(1)
                  : "0";
                return (
                  <div key={status} className="flex items-center gap-1.5 text-xs">
                    <span className={`h-2.5 w-2.5 rounded-full ${colors.dot}`} />
                    <span className="text-muted-foreground">{label}</span>
                    <span className="font-semibold tabular-nums">{count}</span>
                    <span className="text-muted-foreground">({pct}%)</span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Action Cards */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Quick Actions</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger-cards">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link key={action.href} to={action.href}>
                <Card className="h-full card-hover cursor-pointer">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">
                        {action.label}
                      </CardTitle>
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-muted-foreground">
                      {action.desc}
                    </p>
                    <div className="mt-3 flex items-center text-xs font-medium text-primary">
                      <span>Open</span>
                      <ArrowRight className="ml-1 h-3 w-3" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div>
      <div className="mb-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="mt-1 h-4 w-72" />
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4 rounded" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16" />
              <Skeleton className="mt-1 h-3 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Pipeline bar */}
      <Card className="mb-8">
        <CardHeader>
          <Skeleton className="h-5 w-28" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-8 w-full rounded-lg" />
          <div className="flex flex-wrap gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-20" />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Quick actions */}
      <Skeleton className="mb-3 h-6 w-28" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="h-full">
            <CardHeader>
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-5 w-5 rounded" />
              </div>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="mt-3 h-4 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
