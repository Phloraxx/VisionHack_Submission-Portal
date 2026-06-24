import type { LoaderFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
import type { InstitutionRecord } from "~/lib/types";

export async function loader({ request }: LoaderFunctionArgs) {
	if (request.method !== "GET") {
		return new Response("Method not allowed", { status: 405 });
	}

	const auth = await requireAuthJson(request);
	if (auth instanceof Response) return auth;

	const pb = auth.pb;
	const user = auth.user;

	try {
		// Admin/coordinator: full list with institution codes
		if (user.role === "admin" || user.role === "coordinator") {
			const institutions = await pb.collection("institutions").getList<InstitutionRecord>(1, 1000, {
				sort: "name",
				fields: "id,name,district,code",
			});

			return Response.json(
				{ institutions: institutions.items },
				{
					status: 200,
					headers: {
						"Cache-Control": "public, max-age=60, s-maxage=120",
					},
				},
			);
		}

		// Other authenticated roles: return only their own institution, no code
		const institution = await pb
			.collection("institutions")
			.getOne<InstitutionRecord>(user.institutionId, {
				fields: "id,name,district",
			});

		return Response.json(
			{ institutions: [institution] },
			{
				status: 200,
				headers: {
					"Cache-Control": "public, max-age=60, s-maxage=120",
				},
			},
		);
	} catch (err) {
		console.error("[/api/institutions] failed:", err);
		return Response.json({ error: "Failed to fetch institutions." }, { status: 500 });
	}
}
