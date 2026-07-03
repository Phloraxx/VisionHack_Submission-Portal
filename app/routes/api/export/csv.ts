/**
 * CSV Export API — returns downloadable CSV of teams and members.
 * GET /api/export/csv?filterStatus=all
 */
import type { LoaderFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
import { TEAM_STATUSES } from "~/lib/constants";
import { STATUS_LABELS } from "~/lib/team-status";
import type { MemberRecord, TeamStatus, TeamView } from "~/lib/types";
import { escapeCsv } from "~/lib/utils";

export async function loader({ request }: LoaderFunctionArgs) {
	const auth = await requireAuthJson(request);
	if (auth instanceof Response) return auth;
	if (auth.user.role !== "admin") {
		return new Response(JSON.stringify({ error: "Forbidden" }), {
			status: 403,
			headers: { "Content-Type": "application/json" },
		});
	}

	const url = new URL(request.url);
	const rawStatus = url.searchParams.get("filterStatus") || "all";
	// Only treat the value as a real status; otherwise "all".
	const filterStatus = TEAM_STATUSES.includes(rawStatus as TeamStatus)
		? (rawStatus as TeamStatus)
		: "all";
	const searchQuery = (url.searchParams.get("q") || "").trim().slice(0, 100);

	const pb = auth.pb;

	// Build the PocketBase filter from status + search query.
	const clauses: string[] = [];
	if (filterStatus !== "all") {
		clauses.push(pb.filter("status = {:status}", { status: filterStatus }));
	}
	if (searchQuery) {
		const safe = searchQuery.replace(/[.*+?^${}()|[\]\\"]/g, "\\$&");
		clauses.push(pb.filter("(name ~ {:q} || teamCode ~ {:q})", { q: safe }));
	}
	const teamFilter = clauses.length > 0 ? clauses.join(" && ") : undefined;

	// Push the filter into PocketBase instead of fetching everything
	// and filtering in JS.
	const MAX_SAFE_LIST = 500;
	const filteredResult = await pb.collection("teams").getList<TeamView>(1, MAX_SAFE_LIST, {
		filter: teamFilter,
		expand: "institutionId,leaderUserId",
		sort: "-created",
	});
	const filtered = filteredResult.items;
	const truncated = filteredResult.totalItems > MAX_SAFE_LIST;
	if (truncated) {
		console.warn(`[teams] More than ${MAX_SAFE_LIST} items — pagination needed`);
	}

	// Fetch only the members of the teams we're exporting.
	const teamIds = filtered.map((t) => t.id);
	const members =
		teamIds.length > 0
			? (
					await pb.collection("members").getList<MemberRecord>(1, MAX_SAFE_LIST, {
						filter: pb.filter(
							teamIds.map((_, i) => `teamId = {:t${i}}`).join(" || "),
							Object.fromEntries(teamIds.map((id, i) => [`t${i}`, id])),
						),
					})
				).items
			: [];

	const membersByTeam: Record<string, MemberRecord[]> = {};
	for (const m of members) {
		const list = membersByTeam[m.teamId] ?? (membersByTeam[m.teamId] = []);
		list.push(m);
	}

	const headers = [
		"Team Name",
		"Team Code",
		"Status",
		"Institution",
		"District",
		"Team Lead Name",
		"Team Lead Email",
		"Idea Title",
		"Idea Description",
		"Idea Tech Stack",
		"Submission File",
		"Created At",
		"Member Count",
		"Member 1 Name",
		"Member 1 Email",
		"Member 1 Phone",
		"Member 1 Gender",
		"Member 1 Role",
		"Member 2 Name",
		"Member 2 Email",
		"Member 2 Phone",
		"Member 2 Gender",
		"Member 2 Role",
		"Member 3 Name",
		"Member 3 Email",
		"Member 3 Phone",
		"Member 3 Gender",
		"Member 3 Role",
		"Member 4 Name",
		"Member 4 Email",
		"Member 4 Phone",
		"Member 4 Gender",
		"Member 4 Role",
		"Member 5 Name",
		"Member 5 Email",
		"Member 5 Phone",
		"Member 5 Gender",
		"Member 5 Role",
	];

	/**
	 * Build a single CSV row from a team and its members.
	 */
	function buildRow(team: TeamView, members: MemberRecord[]): string {
		const inst = team.expand?.institutionId;
		const leader = team.expand?.leaderUserId;

		const row = [
			escapeCsv(team.name),
			escapeCsv(team.teamCode || ""),
			escapeCsv(STATUS_LABELS[team.status] || team.status),
			escapeCsv(inst?.name || ""),
			escapeCsv(inst?.district || ""),
			escapeCsv(leader?.name || ""),
			escapeCsv(leader?.email || ""),
			escapeCsv(team.idea_title || ""),
			escapeCsv(team.idea_desc || ""),
			escapeCsv(team.idea_tech_stack || ""),
			escapeCsv(team.submission_file || ""),
			escapeCsv(team.created || ""),
			String(members.length),
		];

		for (let i = 0; i < 5; i++) {
			const m = members[i];
			row.push(
				escapeCsv(m?.fullName || ""),
				escapeCsv(m?.email || ""),
				escapeCsv(m?.phone || ""),
				escapeCsv(m?.gender || ""),
				escapeCsv(m?.role || ""),
			);
		}
		return row.join(",");
	}

	const encoder = new TextEncoder();
	const csvPrefix = truncated
		? `# WARNING: Data truncated. Showing ${MAX_SAFE_LIST} of ${filteredResult.totalItems} total items.\n`
		: "";
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(`\uFEFF${csvPrefix}${headers.join(",")}\n`));
			for (const team of filtered) {
				const row = buildRow(team, membersByTeam[team.id] || []);
				controller.enqueue(encoder.encode(`${row}\n`));
			}
			controller.close();
		},
	});

	const responseHeaders: Record<string, string> = {
		"Content-Type": "text/csv; charset=utf-8",
		"Content-Disposition": `attachment; filename="teams_export_${new Date().toISOString().split("T")[0]}.csv"`,
		// PII export — never cache.
		"Cache-Control": "no-store",
		"X-Total-Count": String(filteredResult.totalItems),
	};

	return new Response(stream, {
		status: 200,
		headers: responseHeaders,
	});
}
