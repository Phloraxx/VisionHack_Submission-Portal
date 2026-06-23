import { Building2, Filter, MapPin, Users } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	isRouteErrorResponse,
	useLoaderData,
	useNavigation,
	useRouteError,
	useSearchParams,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
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
import { requireRole } from "~/lib/auth.server";
import { getMemberCountsForTeams } from "~/lib/team.server";
import type { TeamStatus, TeamView } from "~/lib/types";

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

const PAGE_SIZE = 50;
const VALID_STATUSES = [
	"invited",
	"registered",
	"shortlisted",
	"submitted",
	"selected",
	"rejected",
	"withdrawn",
] as const;
export async function loader({ request }: LoaderFunctionArgs) {
	const { user, pb } = await requireRole(request, ["coordinator"]);
	pb.autoCancellation(false);

	const url = new URL(request.url);
	const page = Math.max(1, Number(url.searchParams.get("page") ?? 1) || 1);
	const search = (url.searchParams.get("q") ?? "").trim();
	const district = url.searchParams.get("district") ?? "all";
	const status = url.searchParams.get("status") ?? "all";
	const institution = url.searchParams.get("institution") ?? "all";

	// Coordinator can see all teams; paginate the teams query and skip
	// the expensive full-list scan. The institutions list is bounded
	// (a few hundred at most for a hackathon) and is still loaded once.
	// PB's filter syntax does NOT support `expand.X.field` for filtering
	// by related-record fields. To filter teams by district, we resolve
	// the district to institution IDs and filter by `institutionId` instead.
	const institutions = await pb.collection("institutions").getList<InstitutionRecord>(1, 200, {
		expand: "campusLeadId",
		sort: "name",
		fields: "id,name,district,code,campusLeadId,expand.campusLeadId.name,expand.campusLeadId.email",
	});

	const teamClauses: string[] = [];
	if (search) {
		const safe = search.slice(0, 100).replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");
		teamClauses.push(pb.filter("(name ~ {:search} || teamCode ~ {:search})", { search: safe }));
	}
	if (
		status &&
		status !== "all" &&
		VALID_STATUSES.includes(status as (typeof VALID_STATUSES)[number])
	) {
		teamClauses.push(pb.filter("status = {:status}", { status }));
	}
	if (district && district !== "all") {
		const instIds = institutions.items.filter((i) => i.district === district).map((i) => i.id);
		if (instIds.length > 0) {
			// Institution IDs are PB-generated UUIDs from the database, not from user input.
			// The district filter determines which institutions are selected; the district
			// value itself is validated implicitly against existing institutions.
			// PB doesn't accept SQL `IN` lists; we expand to `||` clauses.
			const idFilters = instIds.map((id) => `institutionId = {:id_${id}}`);
			const filterParams: Record<string, string> = {};
			for (const id of instIds) {
				filterParams[`id_${id}`] = id;
			}
			const orChain = idFilters.join(" || ");
			teamClauses.push(pb.filter(`(${orChain})`, filterParams));
		} else {
			// District has no institutions — short-circuit to empty.
			return {
				user,
				teams: [] as TeamWithExpand[],
				institutions: institutions.items,
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
				scannedCount: 0,
				activeFilters: { search, status, district, institution },
			};
		}
	}
	if (institution && institution !== "all") {
		teamClauses.push(pb.filter("institutionId = {:id}", { id: institution }));
	}
	const teamFilter = teamClauses.length > 0 ? teamClauses.join(" && ") : undefined;

	// For accurate per-status counts and per-institution aggregates we scan
	// a bounded set of teams (id/status/institutionId only) matching the
	// current filter — independent of the page slice. Capped to keep it cheap.
	const COUNT_SCAN_CAP = 1000;

	const [teamsPage, countScan] = await Promise.all([
		pb.collection("teams").getList<TeamWithExpand>(page, PAGE_SIZE, {
			filter: teamFilter,
			expand: "institutionId,leaderUserId",
			sort: "-created",
			fields:
				"id,name,teamCode,status,created,institutionId,leaderUserId,expand.institutionId.name,expand.leaderUserId.name,expand.leaderUserId.email,expand.institutionId.district",
		}),
		pb.collection("teams").getList<{
			status: TeamStatus;
			institutionId: string;
		}>(1, COUNT_SCAN_CAP, {
			filter: teamFilter,
			fields: "status,institutionId",
		}),
	]);

	// Member counts for the visible page only.
	const memberCounts = await getMemberCountsForTeams(
		pb,
		teamsPage.items.map((t) => t.id),
	);

	// Status counts + per-institution aggregates across the (filtered) scan.
	const statusCounts: Partial<Record<TeamStatus, number>> = {};
	const teamsByInstitution: Record<
		string,
		{ total: number; registered: number; shortlisted: number }
	> = {};
	for (const t of countScan.items) {
		statusCounts[t.status] = (statusCounts[t.status] ?? 0) + 1;
		if (!teamsByInstitution[t.institutionId]) {
			teamsByInstitution[t.institutionId] = {
				total: 0,
				registered: 0,
				shortlisted: 0,
			};
		}
		const agg = teamsByInstitution[t.institutionId];
		agg.total++;
		if (t.status === "registered") agg.registered++;
		if (t.status === "shortlisted") agg.shortlisted++;
	}

	const uniqueInstitutionIds = new Set(countScan.items.map((t) => t.institutionId)).size;

	return {
		user,
		teams: teamsPage.items,
		institutions: institutions.items,
		memberCounts,
		page: teamsPage.page,
		perPage: teamsPage.perPage,
		totalItems: teamsPage.totalItems,
		totalPages: teamsPage.totalPages,
		statusCounts,
		teamsByInstitution,
		uniqueInstitutionIds,
		scannedCount: Math.min(countScan.totalItems, COUNT_SCAN_CAP),
		// Echo back the active filters so the UI can stay in sync.
		activeFilters: { search, status, district, institution },
	};
}

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
		teams: TeamWithExpand[];
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
				<MetricCard label="Institutions" value={stats.totalInstitutions} icon={Building2} />
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
							searchPlaceholder="Search teams\u2026"
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

export function ErrorBoundary() {
	const error = useRouteError();
	let message = "Something went wrong";
	if (isRouteErrorResponse(error)) {
		message = `Error ${error.status} — ${error.statusText || "Access denied"}`;
	} else if (error instanceof Error) {
		message = error.message;
	}
	return (
		<div className="flex min-h-[50vh] items-center justify-center p-8">
			<div className="mx-auto max-w-md text-center">
				<p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-danger">Error</p>
				<h1 className="mb-2 text-xl font-semibold tracking-tight">{message}</h1>
				<button
					type="button"
					onClick={() => window.location.reload()}
					className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
				>
					Try again
				</button>
			</div>
		</div>
	);
}
