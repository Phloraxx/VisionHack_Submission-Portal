import type { LoaderFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
import { getEnv } from "~/lib/env.server";

export async function loader({ request }: LoaderFunctionArgs) {
	if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });

	// Unauthenticated and non-admin requests get only a minimal status.
	const auth = await requireAuthJson(request);
	if (!(auth instanceof Response) && auth.user.role === "admin") {
		// Admin-authenticated: include PocketBase connectivity and timestamp.
		const pbUrl = getEnv().POCKETBASE_URL;
		let pbStatus: "ok" | "down" = "ok";
		try {
			const resp = await fetch(`${pbUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
			pbStatus = resp.ok ? "ok" : "down";
		} catch {
			pbStatus = "down";
		}
		return Response.json(
			{
				status: pbStatus === "ok" ? "ok" : "degraded",
				pocketbase: pbStatus,
				timestamp: new Date().toISOString(),
			},
			{ status: pbStatus === "ok" ? 200 : 503 },
		);
	}

	return Response.json({ status: "ok" });
}
