import { Link, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import { STATUS_LABELS, STATUS_COLORS } from "~/lib/team-status";
import { FEATURE_FLAGS } from "~/lib/feature-flags";
import type { TeamStatus } from "~/lib/types";
import { Card, CardContent } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { MetricCard } from "~/components/shared/metric-card";
import { PanelHeader } from "~/components/shared/panel-header";
import {
  Users,
  Building2,
  Download,
  University,
  ArrowRight,
  Settings,
  TrendingUp,
} from "lucide-react";

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireRole(request, ["admin"]);
  const pb = createSuperuserClient();

  // All three queries are independent — run them in parallel. Only the
  // teams scan needs full rows (for per-status counts, and only the
  // `status` field); institution/user totals come from `totalItems`.
  const [teams, institutionsPage, usersPage] = await Promise.all([
    pb.collection("teams").getFullList<{ status: TeamStatus }>({
      fields: "status",
    }),
    pb.collection("institutions").getList(1, 1, { fields: "id" }),
    pb.collection("users").getList(1, 1, { fields: "id" }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const team of teams) {
    statusCounts[team.status] = (statusCounts[team.status] || 0) + 1;
  }

  return {
    user,
    totalTeams: teams.length,
    totalInstitutions: institutionsPage.totalItems,
    totalUsers: usersPage.totalItems,
    statusCounts,
  };
}

export function meta() {
  return [{ title: "Overview — VisionHack Admin" }];
}

export default function AdminDashboard() {
  const { totalTeams, totalInstitutions, totalUsers, statusCounts } =
    useLoaderData() as {
      totalTeams: number;
      totalInstitutions: number;
      totalUsers: number;
      statusCounts: Record<string, number>;
    };

  const statusEntries = (
    Object.entries(STATUS_LABELS) as [TeamStatus, string][]
  ).filter(([status]) => (statusCounts[status] || 0) > 0);

  const submittedCount =
    (statusCounts.submitted ?? 0) +
    (statusCounts.selected ?? 0) +
    (statusCounts.rejected ?? 0);

  return (
    <div className="space-y-10">
      {/* ------------------------------------------------------------
          HERO STRIP — mission title + live event signal
          ------------------------------------------------------------ */}
      <div className="relative overflow-hidden rounded-lg border border-border bg-card">
        <div className="vh-grid-bg absolute inset-0 opacity-40" aria-hidden="true" />
        <div
          className="absolute -top-24 -right-24 h-72 w-72 rounded-full opacity-60 vh-wash-tr"
          aria-hidden="true"
        />
        <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-end md:justify-between md:p-8">
          <div className="space-y-3 max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
              VisionHack · 2026 · Admin
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              The event is live.
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed">
              {submittedCount} of {totalTeams} teams have submitted ideas.
              {" "}
              {statusCounts.shortlisted ?? 0} are awaiting final review.
            </p>
          </div>
          <Link
            to="/admin/teams"
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity shrink-0"
          >
            Open review queue
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>

      {/* ------------------------------------------------------------
          STATS — 4 compact metric cards
          ------------------------------------------------------------ */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger-cards">
        <MetricCard
          label="Teams"
          value={totalTeams}
          icon={Users}
          context={`${statusCounts.registered ?? 0} registered`}
        />
        <MetricCard
          label="Institutions"
          value={totalInstitutions}
          icon={Building2}
          context={
            totalInstitutions > 0
              ? `${(totalTeams / totalInstitutions).toFixed(1)} avg teams / institution`
              : "—"
          }
        />
        <MetricCard
          label="Submitted"
          value={submittedCount}
          icon={TrendingUp}
          tone="info"
          context={`${totalTeams - submittedCount} in pipeline`}
        />
        <MetricCard
          label="Users"
          value={totalUsers}
          icon={Users}
          context="Leads, coordinators, admins"
        />
      </div>

      {/* ------------------------------------------------------------
          PIPELINE — full-width band, dominant visualization
          ------------------------------------------------------------ */}
      {totalTeams > 0 && (
        <Card>
          <CardContent className="p-6">
            <PanelHeader
              eyebrow="Pipeline"
              title="Where teams are"
              description="Distribution across the seven workflow states."
              actions={
                <Link
                  to="/admin/teams"
                  className="inline-flex h-8 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  View all teams
                  <ArrowRight className="h-3 w-3" />
                </Link>
              }
            />

            {/* Stacked bar */}
            <div className="flex h-10 w-full overflow-hidden rounded-md border border-border">
              {statusEntries.map(([status, label]) => {
                const count = statusCounts[status] || 0;
                const pct = (count / totalTeams) * 100;
                if (pct < 1) return null;
                const colors = STATUS_COLORS[status];
                return (
                  <div
                    key={status}
                    className={`${colors.dot} flex items-center justify-center text-[10px] font-bold text-white transition-all`}
                    style={{
                      width: `${pct}%`,
                      minWidth: pct > 5 ? "3rem" : undefined,
                    }}
                    title={`${label}: ${count} (${pct.toFixed(1)}%)`}
                  >
                    {pct > 8 ? count : ""}
                  </div>
                );
              })}
            </div>

            {/* Legend */}
            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {statusEntries.map(([status, label]) => {
                const colors = STATUS_COLORS[status];
                const count = statusCounts[status] || 0;
                const pct = totalTeams > 0
                  ? ((count / totalTeams) * 100).toFixed(1)
                  : "0";
                return (
                  <Link
                    key={status}
                    to={`/admin/teams?status=${status}`}
                    className="group flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2 transition-colors hover:border-foreground/20"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${colors.dot}`}
                      />
                      <span className="truncate text-xs text-muted-foreground group-hover:text-foreground">
                        {label}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1 shrink-0">
                      <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                        {count}
                      </span>
                      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                        {pct}%
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------
          QUICK ACTIONS — 2 large cards, dominant CTA surface
          ------------------------------------------------------------ */}
      <div>
        <PanelHeader
          eyebrow="Operations"
          title="Where to next"
          description="The four surfaces you'll touch most as an operator."
        />
        <div className="grid gap-4 md:grid-cols-2">
          <Link
            to="/admin/teams"
            className="group block focus-visible:outline-none"
          >
            <Card variant="elevated" className="h-full card-hover">
              <CardContent className="flex h-full flex-col justify-between p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-primary">
                      Review queue
                    </p>
                    <h3 className="text-lg font-semibold tracking-tight">
                      All teams
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Search, filter, and transition {totalTeams} teams through
                      the pipeline.
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-2.5 shrink-0">
                    <Users className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between text-sm">
                  <span className="font-mono tabular-nums text-2xl font-semibold">
                    {totalTeams}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
                    Open queue
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link
            to="/admin/campus-leads"
            className="group block focus-visible:outline-none"
          >
            <Card variant="elevated" className="h-full card-hover">
              <CardContent className="flex h-full flex-col justify-between p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-primary">
                      Institutions
                    </p>
                    <h3 className="text-lg font-semibold tracking-tight">
                      Campus leads
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Invite and manage {totalInstitutions} campus leads across
                      institutions.
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-2.5 shrink-0">
                    <University className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between text-sm">
                  <span className="font-mono tabular-nums text-2xl font-semibold">
                    {totalInstitutions}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
                    Manage
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link
            to="/admin/config"
            className="group block focus-visible:outline-none"
          >
            <Card variant="elevated" className="h-full card-hover">
              <CardContent className="flex h-full flex-col justify-between p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-primary">
                      Event
                    </p>
                    <h3 className="text-lg font-semibold tracking-tight">
                      Configuration
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Toggle phases, set deadlines, adjust workflow rules.
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-2.5 shrink-0">
                    <Settings className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between text-sm">
                  <span className="font-mono tabular-nums text-2xl font-semibold">
                    {String(FEATURE_FLAGS.length).padStart(2, "0")}
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
                    Configure
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link
            to="/admin/export"
            className="group block focus-visible:outline-none"
          >
            <Card variant="elevated" className="h-full card-hover">
              <CardContent className="flex h-full flex-col justify-between p-6">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1.5 min-w-0">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-primary">
                      Data
                    </p>
                    <h3 className="text-lg font-semibold tracking-tight">
                      Export
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      Download team, member, and questionnaire data as CSV.
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-muted/30 p-2.5 shrink-0">
                    <Download className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
                <div className="mt-6 flex items-center justify-between text-sm">
                  <span className="font-mono tabular-nums text-2xl font-semibold">
                    CSV
                  </span>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary group-hover:underline">
                    Export
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="space-y-10">
      {/* Hero skeleton */}
      <div className="rounded-lg border border-border bg-card p-8">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="mt-3 h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-96" />
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-5 space-y-3"
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>

      {/* Pipeline */}
      <div className="rounded-lg border border-border bg-card p-6 space-y-4">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-10 w-full rounded-md" />
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full rounded-md" />
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-6 space-y-3"
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="mt-4 h-7 w-20" />
          </div>
        ))}
      </div>
    </div>
  );
}
