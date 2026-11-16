export { default as ErrorBoundary } from "~/components/shared/route-error-boundary";
import { Users } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useLoaderData, useNavigation, useSearchParams } from "react-router";
import { FilterableTeamList } from "~/components/shared/filterable-team-list";
import { MetricCard } from "~/components/shared/metric-card";
import { PanelHeader } from "~/components/shared/panel-header";
import { Skeleton } from "~/components/ui/skeleton";
import { TEAM_STATUSES } from "~/lib/constants";
import { teams as teamsRepo } from "~/lib/db.server";
import { secureLoader } from "~/lib/loader.server";
import { getMemberCountsForTeams } from "~/lib/team.server";
import type { TeamStatus, TeamView } from "~/lib/types";

const PAGE_SIZE = 50;

export const loader = secureLoader({ roles: ["admin"] }, async ({ user, pb, request }) => {
	const url = new URL(request.url);
	const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
	const search = (url.searchParams.get("q") ?? "").trim();
	const status = url.searchParams.get("status") ?? "";

	// Server-side filter. The repository's `q` option is a `contains` match
	// on `name` and `team_code` (the same two local fields PocketBase's `~`
	// operator covered); substring match across expanded relations is not
	// expressible in SQL without a join, so lead name/email and institution
	// name are still post-filtered in JS below. The page is bounded to
	// PAGE_SIZE, so the post-filter is cheap.
	const statusFilter =
		status && status !== "all" && TEAM_STATUSES.includes(status as (typeof TEAM_STATUSES)[number])
			? (status as TeamStatus)
			: undefined;

	// Page slice + a fields-only scan for per-status counts. We cap the
	// count scan at 500 rows; for 500+ teams, the metric cards become
	// approximate. (A future migration can add server-side aggregations
	// if the event grows past this size.)
	const COUNT_SCAN_CAP = 500;

	const [pageResult, countScan] = await Promise.all([
		teamsRepo.list(user, {
			page,
			perPage: PAGE_SIZE,
			sort: "-created",
			q: search ? search.slice(0, 100) : undefined,
			status: statusFilter,
		}),
		teamsRepo.list(user, {
			page: 1,
			perPage: COUNT_SCAN_CAP,
			q: search ? search.slice(0, 100) : undefined,
			status: statusFilter,
		}),
	]);

	// Member counts for THIS PAGE only — full counts are too expensive.
	const teamIds = pageResult.items.map((t) => t.id);
	const memberCounts = await getMemberCountsForTeams(pb, teamIds, user);

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
});

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
		teams: TeamView[];
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
		return teams.filter((t: TeamView) => {
			const lead = t.expand?.leaderUserId;
			const inst = t.expand?.institutionId;
			return (
				t.name.toLowerCase().includes(q) ||
				(t.teamCode || "").toLowerCase().includes(q) ||
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
				<MetricCard label="Registered" value={statusCounts.registered ?? 0} tone="info" />
				<MetricCard label="Shortlisted" value={statusCounts.shortlisted ?? 0} tone="primary" />
				<MetricCard label="Submitted" value={statusCounts.submitted ?? 0} tone="success" />
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
						{team.expand?.institutionId && <span>{team.expand.institutionId.name}</span>}
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
