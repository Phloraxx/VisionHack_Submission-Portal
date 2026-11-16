import type { LoaderFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
import { query } from "~/lib/db.server";
import { ipRateLimitKey } from "~/lib/ip.server";
import { checkRateLimit } from "~/lib/rate-limiter.server";

export async function loader({ request }: LoaderFunctionArgs) {
	// The probe runs before auth so the container healthcheck can reach it
	// without credentials — which also makes it the one endpoint any client can
	// use to force a database query. Cap it per address; the healthcheck itself
	// arrives without proxy headers, so it is never bucketed.
	const ipKey = ipRateLimitKey("health", request);
	if (ipKey) {
		try {
			checkRateLimit(ipKey, 60, 60_000);
		} catch {
			return Response.json({ status: "degraded" }, { status: 429 });
		}
	}

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
