import { Building2, Filter, MapPin, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLoaderData, useNavigation, useSearchParams } from "react-router";
import { FilterableTeamList } from "~/components/shared/filterable-team-list";
import { MetricCard } from "~/components/shared/metric-card";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Skeleton } from "~/components/ui/skeleton";
import { TEAM_STATUSES } from "~/lib/constants";
import { institutions as institutionsRepo, teams as teamsRepo } from "~/lib/db.server";
import { secureLoader } from "~/lib/loader.server";
import { getMemberCountsForTeams } from "~/lib/team.server";
import type { TeamStatus, TeamView } from "~/lib/types";

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

const PAGE_SIZE = 50;
export const loader = secureLoader({ roles: ["coordinator"] }, async ({ user, request }) => {
	const url = new URL(request.url);
	const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
	const search = (url.searchParams.get("q") ?? "").trim();
	const district = url.searchParams.get("district") ?? "all";
	const status = url.searchParams.get("status") ?? "all";
	const institution = url.searchParams.get("institution") ?? "all";

	// Coordinator can see all teams; paginate the teams query and skip
	// the expensive full-list scan. The institutions list is bounded
	// (a few hundred at most for a hackathon) and is still loaded once.
	// Filtering teams by district resolves the district to institution IDs
	// and filters on `institutionId` instead — the repository takes the list.
	const institutionsResult = await institutionsRepo.list(user, { perPage: 200, sort: "name" });
	const institutions = institutionsResult.items;

	const statusFilter =
		status && status !== "all" && TEAM_STATUSES.includes(status as (typeof TEAM_STATUSES)[number])
			? (status as TeamStatus)
			: undefined;

	// Resolve the district + institution filters to one id list. Both are
	// ANDed, so an explicit institution narrows the district's set.
	let institutionIds: string[] | undefined;
	if (district && district !== "all") {
		institutionIds = institutions.filter((i) => i.district === district).map((i) => i.id);
		if (institutionIds.length === 0) {
			// District has no institutions — short-circuit to empty.
			return {
				user,
				teams: [] as TeamView[],
				institutions,
				memberCounts: {} as Record<string, number>,
				page: 1,
				perPage: PAGE_SIZE,
				totalItems: 0,
				totalPages: 1,
				statusCounts: {} as Partial<Record<TeamStatus, number>>,
				teamsByInstitution: {} as Record<
					string,
					{ total: number; registered: number; shortlisted: number }
				>,
				uniqueInstitutionIds: 0,
				activeFilters: { search, status, district, institution },
			};
		}
	}
	if (institution && institution !== "all") {
		// The id comes from the URL, so a malformed value must read as "no
		// match" rather than reaching the `::uuid` cast.
		institutionIds = institutionIds
			? institutionIds.filter((id) => id === institution)
			: [institution];
		if (institutionIds.length === 0) {
			return {
				user,
				teams: [] as TeamView[],
				institutions,
				memberCounts: {} as Record<string, number>,
				page: 1,
				perPage: PAGE_SIZE,
				totalItems: 0,
				totalPages: 1,
				statusCounts: {} as Partial<Record<TeamStatus, number>>,
				teamsByInstitution: {} as Record<
					string,
					{ total: number; registered: number; shortlisted: number }
				>,
				uniqueInstitutionIds: 0,
				activeFilters: { search, status, district, institution },
			};
		}
	}

	const filter = {
		q: search ? search.slice(0, 100) : undefined,
		status: statusFilter,
		institutionId: institutionIds,
	};

	// Page slice + one GROUP BY for the per-status and per-institution
	// counters.
	const [teamsPage, totals] = await Promise.all([
		teamsRepo.list(user, { page, perPage: PAGE_SIZE, sort: "-created", ...filter }),
		teamsRepo.aggregate(user, filter),
	]);

	// Member counts for the visible page only.
	const memberCounts = await getMemberCountsForTeams(
		user,
		teamsPage.items.map((t) => t.id),
	);

	return {
		user,
		teams: teamsPage.items,
		institutions,
		memberCounts,
		page: teamsPage.page,
		perPage: teamsPage.perPage,
		totalItems: teamsPage.totalItems,
		totalPages: teamsPage.totalPages,
		statusCounts: totals.byStatus,
		teamsByInstitution: totals.byInstitution,
		uniqueInstitutionIds: totals.institutions,
		// Echo back the active filters so the UI can stay in sync.
		activeFilters: { search, status, district, institution },
	};
});

export function meta() {
	return [{ title: "Coordinator Dashboard — VisionHack" }];
}

export default function CoordinatorDashboard() {
	const {
		teams,
		institutions,
		memberCounts,
		page,
		totalItems,
		totalPages,
		statusCounts,
		teamsByInstitution,
		uniqueInstitutionIds,
		activeFilters,
	} = useLoaderData() as {
		teams: TeamView[];
		institutions: InstitutionRecord[];
		memberCounts: Record<string, number>;
		page: number;
		perPage: number;
		totalItems: number;
		totalPages: number;
		statusCounts: Partial<Record<TeamStatus, number>>;
		teamsByInstitution: Record<string, { total: number; registered: number; shortlisted: number }>;
		uniqueInstitutionIds: number;
		activeFilters: {
			search: string;
			status: string;
			district: string;
			institution: string;
		};
	};

	const [searchParams, setSearchParams] = useSearchParams();
	const navigation = useNavigation();
	const isLoading = navigation.state === "loading";

	// All filters are URL-driven (server-side) so they stay correct across
	// pagination. The search box keeps local state only to debounce typing.
	const [searchInput, setSearchInput] = useState(activeFilters.search);
	const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [viewMode, setViewMode] = useState<"teams" | "institutions">("teams");

	const districtFilter = activeFilters.district || "all";
	const institutionFilter = activeFilters.institution || "all";
	const statusFilter = activeFilters.status || "all";

	// Keep the search box in sync if the URL changes externally (e.g. back).
	useEffect(() => {
		setSearchInput(activeFilters.search);
	}, [activeFilters.search]);

	// Drop a pending debounce when the route unmounts.
	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

	/** Update one or more URL params, always resetting pagination. */
	const setParams = (updates: Record<string, string>, replace = false) => {
		const params = new URLSearchParams(searchParams);
		for (const [key, value] of Object.entries(updates)) {
			if (value && value !== "all") params.set(key, value);
			else params.delete(key);
		}
		params.delete("page");
		setSearchParams(params, { replace });
	};

	const updateQuery = (next: string) => {
		setSearchInput(next);
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => setParams({ q: next }, true), 250);
	};
	const goToPage = (n: number) => {
		const params = new URLSearchParams(searchParams);
		if (n > 1) params.set("page", String(n));
		else params.delete("page");
		setSearchParams(params);
	};

	// Filter options come from the (bounded) institutions list.
	const uniqueDistricts = useMemo(
		() => Array.from(new Set(institutions.map((i) => i.district).filter(Boolean))).sort(),
		[institutions],
	);

	// Institutions view honors the active district filter (client-side over
	// the small institutions list is fine — it's not paginated).
	const visibleInstitutions = useMemo(() => {
		if (districtFilter === "all") return institutions;
		return institutions.filter((i) => i.district === districtFilter);
	}, [institutions, districtFilter]);

	const stats = {
		totalTeams: totalItems,
		totalInstitutions: uniqueInstitutionIds,
		invited: statusCounts.invited ?? 0,
		registered: statusCounts.registered ?? 0,
		shortlisted: statusCounts.shortlisted ?? 0,
		submitted: statusCounts.submitted ?? 0,
	};

	return (
		<div className="space-y-10">
			<div>
				<p className="mb-2 text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
					VisionHack · 2026 · Coordinator
				</p>
				<h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Coordinator overview</h1>
				<p className="mt-1.5 text-sm text-muted-foreground">
					View teams and institutions filtered by district.
				</p>
			</div>

			{/* District Filter */}
			<Card>
				<CardContent className="p-4">
					<div className="flex items-center gap-4">
						<MapPin className="h-5 w-5 text-muted-foreground shrink-0" />
						<Select
							value={districtFilter}
							onValueChange={(val) => setParams({ district: val, institution: "all" })}
						>
							<SelectTrigger className="w-full md:w-64">
								<SelectValue placeholder="Select district" />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">All districts</SelectItem>
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
								onClick={() => setParams({ district: "all", institution: "all" })}
							>
								Clear
							</Button>
						)}
					</div>
				</CardContent>
			</Card>

			{/* Stats Cards — 6 MetricCards */}
			<div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-6 stagger-cards">
				<MetricCard label="Teams" value={stats.totalTeams} icon={Users} />
				<MetricCard label="Invited" value={stats.invited} />
				<MetricCard label="Registered" value={stats.registered} tone="info" />
				<MetricCard label="Shortlisted" value={stats.shortlisted} tone="primary" />
				<MetricCard label="Submitted" value={stats.submitted} tone="success" />
				<MetricCard label="Inst. w/ Teams" value={stats.totalInstitutions} icon={Building2} />
			</div>

			{/* View Mode + Filters */}
			<Card>
				<CardContent className="p-4 space-y-4">
					<div className="flex items-center justify-between gap-3 flex-wrap">
						<div className="flex items-center gap-2">
							<Filter className="h-4 w-4 text-muted-foreground" />
							<span className="text-sm font-medium">View</span>
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

					{viewMode === "teams" && (
						<FilterableTeamList
							contained
							teams={teams as TeamView[]}
							memberCounts={memberCounts}
							statusCounts={statusCounts}
							totalPages={totalPages}
							currentPage={page}
							totalItems={totalItems}
							searchValue={searchInput}
							statusValue={statusFilter}
							onSearchChange={updateQuery}
							onStatusChange={(val) => setParams({ status: val })}
							onPageChange={goToPage}
							basePath="/teams"
							isLoading={isLoading}
							renderSecondary={(team) => (
								<span className="flex items-center gap-2">
									{team.expand?.institutionId && <span>{team.expand.institutionId.name}</span>}
									{team.expand?.institutionId?.district && (
										<span className="text-muted-foreground/70">
											&middot; {team.expand.institutionId.district}
										</span>
									)}
									{team.expand?.leaderUserId && (
										<span className="text-muted-foreground/70">
											&middot; {team.expand.leaderUserId.name}
										</span>
									)}
								</span>
							)}
							extraFilters={
								<Select
									value={institutionFilter}
									onValueChange={(val) => setParams({ institution: val })}
								>
									<SelectTrigger>
										<SelectValue placeholder="Filter by institution" />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All institutions</SelectItem>
										{institutions.map((inst) => (
											<SelectItem key={inst.id} value={inst.id}>
												{inst.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							}
							searchPlaceholder="Search teams…"
						/>
					)}
				</CardContent>
			</Card>

			{/* Institutions view */}
			{viewMode !== "teams" &&
				(visibleInstitutions.length === 0 ? (
					<Card>
						<CardContent className="py-12 text-center">
							<p className="text-sm font-medium text-foreground">
								No institutions match your filters
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								Clear the search field or set the district filter to All.
							</p>
						</CardContent>
					</Card>
				) : (
					<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
						{visibleInstitutions.map((inst) => {
							const counts = teamsByInstitution[inst.id] || {
								total: 0,
								registered: 0,
								shortlisted: 0,
							};
							return (
								<Card key={inst.id} className="h-full">
									<CardHeader className="pb-3">
										<CardTitle className="text-sm font-semibold">{inst.name}</CardTitle>
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
											<div className="bg-info/10 rounded p-2 text-center">
												<p className="text-xs text-info">Registered</p>
												<p className="text-lg font-bold text-info">{counts.registered}</p>
											</div>
											<div className="bg-success/10 rounded p-2 text-center">
												<p className="text-xs text-success">Shortlisted</p>
												<p className="text-lg font-bold text-success">{counts.shortlisted}</p>
											</div>
										</div>
										{inst.expand?.campusLeadId && (
											<div className="text-xs text-muted-foreground border-t pt-2">
												Lead: {inst.expand.campusLeadId.name} ({inst.expand.campusLeadId.email})
											</div>
										)}
									</CardContent>
								</Card>
							);
						})}
					</div>
				))}
		</div>
	);
}

export { default as ErrorBoundary } from "~/components/shared/route-error-boundary";
