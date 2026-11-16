import type { LoaderFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
import { query } from "~/lib/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
	if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

	// Unauthenticated and non-admin requests get only a minimal status.
	const auth = await requireAuthJson(request);
	if (!(auth instanceof Response) && auth.user.role === "admin") {
		// Admin-authenticated: include database connectivity and timestamp.
		let dbStatus: "ok" | "down" = "ok";
		try {
			await query("SELECT 1");
		} catch {
			dbStatus = "down";
		}
		return Response.json(
			{
				status: dbStatus === "ok" ? "ok" : "degraded",
				database: dbStatus,
				timestamp: new Date().toISOString(),
			},
			{ status: dbStatus === "ok" ? 200 : 503 },
		);
	}

	return Response.json({ status: "ok" });
}
