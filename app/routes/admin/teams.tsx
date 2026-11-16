export { default as ErrorBoundary } from "~/components/shared/route-error-boundary";
import { Users } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

export const loader = secureLoader({ roles: ["admin"] }, async ({ user, request }) => {
	const url = new URL(request.url);
	const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
	const search = (url.searchParams.get("q") ?? "").trim();
	const status = url.searchParams.get("status") ?? "";

	// Server-side filter. The repository's `q` option is a `contains` match
	// on the team name/code plus the joined lead and institution names.
	const statusFilter =
		status && status !== "all" && TEAM_STATUSES.includes(status as (typeof TEAM_STATUSES)[number])
			? (status as TeamStatus)
			: undefined;

	const filter = {
		q: search ? search.slice(0, 100) : undefined,
		status: statusFilter,
	};

	// Page slice + one GROUP BY for the per-status counters.
	const [pageResult, totals] = await Promise.all([
		teamsRepo.list(user, { page, perPage: PAGE_SIZE, sort: "-created", ...filter }),
		teamsRepo.aggregate(user, filter),
	]);

	// Member counts for THIS PAGE only — full counts are too expensive.
	const teamIds = pageResult.items.map((t) => t.id);
	const memberCounts = await getMemberCountsForTeams(user, teamIds);

	return {
		user,
		teams: pageResult.items,
		memberCounts,
		page: pageResult.page,
		perPage: pageResult.perPage,
		totalItems: pageResult.totalItems,
		totalPages: pageResult.totalPages,
		statusCounts: totals.byStatus,
	};
});

export function meta() {
	return [{ title: "Teams — VisionHack Admin" }];
}

export default function AdminTeams() {
	const { teams, memberCounts, page, totalItems, totalPages, statusCounts } = useLoaderData() as {
		teams: TeamView[];
		memberCounts: Record<string, number>;
		page: number;
		perPage: number;
		totalItems: number;
		totalPages: number;
		statusCounts: Partial<Record<TeamStatus, number>>;
	};

	const [searchParams, setSearchParams] = useSearchParams();
	const navigation = useNavigation();
	const isLoading = navigation.state === "loading";

	const searchQuery = searchParams.get("q") ?? "";
	const statusFilter = searchParams.get("status") ?? "all";

	const [searchInput, setSearchInput] = useState(searchQuery);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	// Drop a pending debounce when the route unmounts.
	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

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

	return (
		<div className="space-y-8">
			<PanelHeader
				eyebrow="Pipeline"
				title="All teams"
				description={`Page ${page} of ${totalPages} — ${totalItems} total teams`}
			/>

			{/* Compact stats */}
			<div className="grid gap-3 grid-cols-2 sm:grid-cols-4 stagger-cards">
				<MetricCard label="Total" value={totalItems} icon={Users} />
				<MetricCard label="Registered" value={statusCounts.registered ?? 0} tone="info" />
				<MetricCard label="Shortlisted" value={statusCounts.shortlisted ?? 0} tone="primary" />
				<MetricCard label="Submitted" value={statusCounts.submitted ?? 0} tone="success" />
			</div>

			<FilterableTeamList
				teams={teams}
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
						<span className="text-muted-foreground/70">&middot; {team.created.slice(0, 10)}</span>
					</span>
				)}
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
