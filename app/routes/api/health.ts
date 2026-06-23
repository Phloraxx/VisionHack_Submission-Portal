import type { LoaderFunctionArgs } from "react-router";
import { getEnv } from "~/lib/env.server";

export async function loader({ request }: LoaderFunctionArgs) {
	if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
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
