import type { LoaderFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
import { query } from "~/lib/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
	// Always probe the database: a health check that never touches it cannot
	// observe an outage. The detail is admin-only.
	let dbStatus: "ok" | "down" = "ok";
	try {
		await query("SELECT 1");
	} catch {
		dbStatus = "down";
	}

	const auth = await requireAuthJson(request);
	if (!(auth instanceof Response) && auth.user.role === "admin") {
		return Response.json(
			{
				status: dbStatus === "ok" ? "ok" : "degraded",
				database: dbStatus,
				timestamp: new Date().toISOString(),
			},
			{ status: dbStatus === "ok" ? 200 : 503 },
		);
	}

	return Response.json(
		{ status: dbStatus === "ok" ? "ok" : "degraded" },
		{ status: dbStatus === "ok" ? 200 : 503 },
	);
}
