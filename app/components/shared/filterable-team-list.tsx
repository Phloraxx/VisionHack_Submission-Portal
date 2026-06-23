import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useMemo } from "react";
import { DataList, type DataListRow } from "~/components/shared/data-list";
import { StatusBadge } from "~/components/shared/status-badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { STATUS_LABELS } from "~/lib/team-status";
import type { TeamStatus, TeamView } from "~/lib/types";

export interface FilterableTeamListProps {
	/** Teams to display (already filtered). */
	teams: TeamView[];
	/** Member counts keyed by team id. */
	memberCounts: Record<string, number>;
	/** Per-status counts for the status filter options. */
	statusCounts: Partial<Record<TeamStatus, number>>;
	totalPages: number;
	currentPage: number;
	totalItems: number;
	/** Current search input value. */
	searchValue: string;
	/** Current status filter value ("all" = no filter). */
	statusValue: string;
	/** Called on every keystroke — caller is responsible for debouncing. */
	onSearchChange: (value: string) => void;
	onStatusChange: (value: string) => void;
	onPageChange: (page: number) => void;
	/** Base path for team detail links (e.g. "/admin/teams"). */
	basePath: string;
	isLoading: boolean;
	/** Custom secondary content for each team row. */
	renderSecondary: (team: TeamView) => React.ReactNode;
	/** When inside a Card, suppresses the DataList border to avoid nesting. */
	contained?: boolean;
	/** Post-filter hint text shown above the DataList. */
	filteredHint?: string;
	/** Additional filter controls rendered between search and status select. */
	extraFilters?: React.ReactNode;
	searchPlaceholder?: string;
	emptyMessage?: string;
	emptyHint?: string;
}

export function FilterableTeamList({
	teams,
	memberCounts,
	statusCounts,
	totalPages,
	currentPage,
	totalItems,
	searchValue,
	statusValue,
	onSearchChange,
	onStatusChange,
	onPageChange,
	basePath,
	isLoading,
	renderSecondary,
	contained = false,
	filteredHint,
	extraFilters,
	searchPlaceholder = "Search teams, codes, leads, institutions\u2026",
	emptyMessage = "No teams match your filters",
	emptyHint = "Clear the search field or set the status filter to All to see every team.",
}: FilterableTeamListProps) {
	const uniqueStatuses = useMemo(
		() => Object.keys(statusCounts).sort() as TeamStatus[],
		[statusCounts],
	);

	const rows: DataListRow[] = useMemo(
		() =>
			teams.map((team) => ({
				id: team.id,
				primary: team.name,
				code: team.teamCode,
				secondary: renderSecondary(team),
				metric: {
					label: "Members",
					value: memberCounts[team.id] || 0,
				},
				indicator: <StatusBadge status={team.status} />,
				href: `${basePath}/${team.id}`,
			})),
		[teams, memberCounts, renderSecondary, basePath],
	);

	return (
		<div className="flex flex-col gap-4">
			{/* Filters */}
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
				<div className="relative flex-1 max-w-md">
					<Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
					<Input
						placeholder={searchPlaceholder}
						className="pl-9"
						value={searchValue}
						onChange={(e) => onSearchChange(e.target.value)}
						disabled={isLoading}
					/>
				</div>
				{extraFilters}
				<Select value={statusValue} onValueChange={onStatusChange} disabled={isLoading}>
					<SelectTrigger className="sm:w-56">
						<SelectValue placeholder="Filter by status" />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value="all">All statuses</SelectItem>
						{uniqueStatuses.map((status) => (
							<SelectItem key={status} value={status}>
								{STATUS_LABELS[status] || status}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{/* Post-filter hint */}
			{filteredHint && <p className="text-xs text-muted-foreground -mt-2">{filteredHint}</p>}

			{/* List */}
			<DataList
				rows={rows}
				emptyMessage={emptyMessage}
				emptyHint={emptyHint}
				className={contained ? "border-0 shadow-none rounded-none" : undefined}
			/>

			{/* Pagination */}
			{totalPages > 1 && (
				<div className="flex items-center justify-between border-t border-border pt-4">
					<p className="text-xs text-muted-foreground">
						Page {currentPage} of {totalPages} &middot; {totalItems} teams
					</p>
					<div className="flex items-center gap-2">
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage <= 1 || isLoading}
							onClick={() => onPageChange(currentPage - 1)}
						>
							<ChevronLeft className="h-4 w-4" />
							Previous
						</Button>
						<Button
							variant="outline"
							size="sm"
							disabled={currentPage >= totalPages || isLoading}
							onClick={() => onPageChange(currentPage + 1)}
						>
							Next
							<ChevronRight className="h-4 w-4" />
						</Button>
					</div>
				</div>
			)}
		</div>
	);
}
