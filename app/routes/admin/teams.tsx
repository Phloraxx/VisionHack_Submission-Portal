import { useState, useRef, useMemo } from "react";
import { useLoaderData, useSearchParams, useNavigation } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import { getMemberCountsForTeams } from "~/lib/team.server";
import type { TeamStatus, TeamView } from "~/lib/types";
import { PanelHeader } from "~/components/shared/panel-header";
import { MetricCard } from "~/components/shared/metric-card";
import { Skeleton } from "~/components/ui/skeleton";
import { Users } from "lucide-react";
import { FilterableTeamList } from "~/components/shared/filterable-team-list";

const PAGE_SIZE = 50;

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

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireRole(request, ["admin"]);
  const pb = createSuperuserClient();

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
  const search = (url.searchParams.get("q") ?? "").trim();
  const status = url.searchParams.get("status") ?? "";

  // Build a server-side filter. PB's `~` operator works on local
  // fields (name, teamCode) and on equality of expanded relations
  // (expand.X.field = "...") but NOT for substring match across
  // expanded relations. We therefore scope server-side search to
  // name and teamCode, then post-filter on lead name/email and
  // institution name in JS below. The page is bounded to PAGE_SIZE,
  // so the post-filter is cheap.
  const clauses: string[] = [];
  if (search) {
    const safe = search.slice(0, 100).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    clauses.push(`(name ~ "${safe}" || teamCode ~ "${safe}")`);
  }
  if (status && status !== "all") {
    clauses.push(`status = "${status}"`);
  }
  const filter = clauses.length > 0 ? clauses.join(" && ") : undefined;

  // Page slice + a fields-only scan for per-status counts. We cap the
  // count scan at 500 rows; for 500+ teams, the metric cards become
  // approximate. (A future migration can add server-side aggregations
  // on PB if the event grows past this size.)
  const COUNT_SCAN_CAP = 500;

  const [pageResult, countScan] = await Promise.all([
    pb.collection("teams").getList<TeamWithExpand>(page, PAGE_SIZE, {
      filter,
      expand: "institutionId,leaderUserId",
      sort: "-created",
      fields:
        "id,name,teamCode,status,created,institutionId,leaderUserId,expand.institutionId.name,expand.leaderUserId.name,expand.leaderUserId.email",
    }),
    pb.collection("teams").getList<{ id: string; status: TeamStatus }>(1, COUNT_SCAN_CAP, {
      fields: "id,status",
      $autoCancel: false,
    }),
  ]);

  // Member counts for THIS PAGE only — full counts are too expensive.
  const teamIds = pageResult.items.map((t) => t.id);
  const memberCounts = await getMemberCountsForTeams(pb, teamIds);

  const statusCounts: Partial<Record<TeamStatus, number>> = {};
  for (const t of countScan.items) {
    statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
  }

  return {
    user,
    teams: pageResult.items,
    memberCounts,
    page: pageResult.page,
    perPage: pageResult.perPage,
    totalItems: pageResult.totalItems,
    totalPages: pageResult.totalPages,
    statusCounts,
    scannedCount: Math.min(countScan.totalItems, COUNT_SCAN_CAP),
    scannedCap: COUNT_SCAN_CAP,
  };
}

export function meta() {
  return [{ title: "Teams — VisionHack Admin" }];
}

export default function AdminTeams() {
  const {
    teams,
    memberCounts,
    page,
    totalItems,
    totalPages,
    statusCounts,
    scannedCount,
    scannedCap,
  } = useLoaderData() as {
    teams: TeamWithExpand[];
    memberCounts: Record<string, number>;
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
    statusCounts: Partial<Record<TeamStatus, number>>;
    scannedCount: number;
    scannedCap: number;
  };

  const [searchParams, setSearchParams] = useSearchParams();
  const navigation = useNavigation();
  const isLoading = navigation.state === "loading";

  const searchQuery = searchParams.get("q") ?? "";
  const statusFilter = searchParams.get("status") ?? "all";

  // Push search input into the URL with a 250ms debounce so the loader
  // doesn't refire on every keystroke.
  const [searchInput, setSearchInput] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateQuery = (next: string) => {
    setSearchInput(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams);
      if (next) params.set("q", next);
      else params.delete("q");
      params.delete("page");
      setSearchParams(params, { replace: true });
    }, 250);
  };
  const updateStatus = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next && next !== "all") params.set("status", next);
    else params.delete("status");
    params.delete("page");
    setSearchParams(params, { replace: true });
  };
  const goToPage = (n: number) => {
    const params = new URLSearchParams(searchParams);
    if (n > 1) params.set("page", String(n));
    else params.delete("page");
    setSearchParams(params);
  };

  // Post-filter for the lead name/email and institution name on the
  // CURRENT page only. PB's filter doesn't support substring match on
  // expanded relations, so the loader pre-filters name/teamCode
  // server-side and we do the rest here. With PAGE_SIZE = 50 the
  // post-filter is bounded.
  const visibleTeams = useMemo(() => {
    if (!searchQuery) return teams;
    const q = searchQuery.toLowerCase();
    return teams.filter((t: TeamWithExpand) => {
      const lead = t.expand?.leaderUserId;
      const inst = t.expand?.institutionId;
      return (
        (lead?.name || "").toLowerCase().includes(q) ||
        (lead?.email || "").toLowerCase().includes(q) ||
        (inst?.name || "").toLowerCase().includes(q)
      );
    });
  }, [teams, searchQuery]);

  const isApprox = scannedCount < totalItems;

  return (
    <div className="space-y-8">
      <PanelHeader
        eyebrow="Pipeline"
        title="All teams"
        description={
          isApprox
            ? `Showing page ${page} of ${totalPages} — ${totalItems} total teams (per-status counts scanned ${scannedCount}/${scannedCap})`
            : `Page ${page} of ${totalPages} — ${totalItems} total teams`
        }
      />

      {/* Compact stats */}
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 stagger-cards">
        <MetricCard label="Total" value={totalItems} icon={Users} />
        <MetricCard
          label="Registered"
          value={statusCounts.registered ?? 0}
          tone="info"
        />
        <MetricCard
          label="Shortlisted"
          value={statusCounts.shortlisted ?? 0}
          tone="primary"
        />
        <MetricCard
          label="Submitted"
          value={statusCounts.submitted ?? 0}
          tone="success"
        />
      </div>

      <FilterableTeamList
        teams={visibleTeams as TeamView[]}
        memberCounts={memberCounts}
        statusCounts={statusCounts}
        totalPages={totalPages}
        currentPage={page}
        totalItems={totalItems}
        searchValue={searchInput}
        statusValue={statusFilter}
        onSearchChange={updateQuery}
        onStatusChange={updateStatus}
        onPageChange={goToPage}
        basePath="/teams"
        isLoading={isLoading}
        renderSecondary={(team) => (
          <span className="flex items-center gap-2 flex-wrap">
            {team.expand?.institutionId && (
              <span>{team.expand.institutionId.name}</span>
            )}
            {team.expand?.leaderUserId && (
              <span className="text-muted-foreground">
                &middot; {team.expand.leaderUserId.name}
              </span>
            )}
            <span className="text-muted-foreground/70">
              &middot; {new Date(team.created).toLocaleDateString()}
            </span>
          </span>
        )}
        filteredHint={
          searchQuery && visibleTeams.length < teams.length
            ? `Showing ${visibleTeams.length} of ${teams.length} teams on this page (search filter applied to lead / institution names).`
            : undefined
        }
        emptyMessage={
          searchQuery || statusFilter !== "all"
            ? "No teams match your filters"
            : "No teams registered yet"
        }
        emptyHint={
          searchQuery || statusFilter !== "all"
            ? "Clear the search field or set the status filter to All to see every team."
            : "Teams appear here once leaders register them."
        }
      />
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="space-y-8">
      <div>
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-2 h-7 w-32" />
        <Skeleton className="mt-1 h-4 w-64" />
      </div>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-5 space-y-3"
          >
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-8 w-12" />
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <Skeleton className="h-9 flex-1 max-w-md rounded-md" />
        <Skeleton className="h-9 w-56 rounded-md" />
      </div>
      <div className="rounded-lg border border-border bg-card divide-y divide-border">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-4">
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-64" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
