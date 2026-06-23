import { Download, FileDown, Search } from "lucide-react";
import { useState } from "react";
import { isRouteErrorResponse, useLoaderData, useRouteError } from "react-router";
import { MetricCard } from "~/components/shared/metric-card";
import { PanelHeader } from "~/components/shared/panel-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { secureLoader } from "~/lib/loader.server";
import { STATUS_LABELS } from "~/lib/team-status";
import type { TeamStatus, TeamView } from "~/lib/types";
import { countByKey } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

// The export *page* only renders counts + filters; the actual CSV is
// produced by /api/export/csv. So the loader needs team metadata for the
// filter UI and member counts only — not full member rows.
export const loader = secureLoader({ roles: ["admin"] }, async ({ user, pb }) => {
	const MAX_SAFE_LIST = 500;
	const [teamsResult, membersResult] = await Promise.all([
		pb.collection("teams").getList<TeamView>(1, MAX_SAFE_LIST, {
			expand: "institutionId,leaderUserId",
			sort: "-created",
			fields:
				"id,name,teamCode,status,institutionId,leaderUserId,created,updated,expand.institutionId.name,expand.institutionId.district,expand.leaderUserId.name,expand.leaderUserId.email",
		}),
		pb.collection("members").getList<{ teamId: string }>(1, MAX_SAFE_LIST, {
			fields: "teamId",
		}),
	]);
	const teams = teamsResult.items;
	const members = membersResult.items;
	if (teamsResult.totalItems > MAX_SAFE_LIST) {
		console.warn(`[teams] More than ${MAX_SAFE_LIST} items — pagination needed`);
	}
	if (membersResult.totalItems > MAX_SAFE_LIST) {
		console.warn(`[members] More than ${MAX_SAFE_LIST} items — pagination needed`);
	}

	const memberCounts = countByKey(members, (m) => m.teamId);
	const totalMembers = members.length;

	return {
		user,
		teams,
		memberCounts,
		totalMembers,
	};
});

export function meta() {
	return [{ title: "Export Data — VisionHack" }];
}

export default function AdminExport() {
	const { teams, memberCounts, totalMembers } = useLoaderData() as {
		teams: TeamView[];
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
			(team.expand?.institutionId?.name || "").toLowerCase().includes(query) ||
			(team.expand?.leaderUserId?.name || "").toLowerCase().includes(query);
		const matchesStatus = statusFilter === "all" || team.status === statusFilter;
		return matchesSearch && matchesStatus;
	});

	const filteredMemberCount = filteredTeams.reduce((sum, t) => sum + (memberCounts[t.id] || 0), 0);

	const uniqueStatuses = Array.from(new Set(teams.map((t) => t.status))).sort();

	return (
		<div className="space-y-10">
			<PanelHeader
				eyebrow="Data"
				title="Export"
				description="Export filtered teams and members data as CSV."
			/>

			{/* Stats */}
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger-cards">
				<MetricCard label="Total teams" value={teams.length} icon={Download} />
				<MetricCard label="Filtered teams" value={filteredTeams.length} tone="info" />
				<MetricCard label="Total members" value={totalMembers} />
				<MetricCard label="Filtered members" value={filteredMemberCount} tone="info" />
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
						The export includes team info, institution, lead, and up to 5 members per team.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<a
						href={`/api/export/csv?filterStatus=${statusFilter}`}
						className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 transition-colors w-full sm:w-auto"
					>
						<Download className="h-5 w-5" />
						Download CSV ({filteredTeams.length} teams, {filteredMemberCount} members)
					</a>

					{filteredTeams.length === 0 && (
						<p className="text-sm text-muted-foreground mt-2">
							No teams match your current filters. Adjust filters to export data.
						</p>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

export function ErrorBoundary() {
	const error = useRouteError();
	let message = "Something went wrong";
	let details = "An unexpected error occurred while loading this page.";

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? "Page not found" : `${error.status}: ${error.statusText}`;
		details = error.data?.message || details;
	} else if (import.meta.env.DEV && error instanceof Error) {
		details = error.message;
	}

	return (
		<div className="flex min-h-[50vh] items-center justify-center p-8">
			<div className="mx-auto max-w-md text-center">
				<p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-destructive">
					Error
				</p>
				<h1 className="mb-2 text-xl font-semibold tracking-tight">{message}</h1>
				<p className="text-sm text-muted-foreground">{details}</p>
				<button
					type="button"
					onClick={() => window.location.reload()}
					className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
				>
					Try again
				</button>
			</div>
		</div>
	);
}
