import type { LoaderFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
import { institutions } from "~/lib/db.server";

export async function loader({ request }: LoaderFunctionArgs) {
	const auth = await requireAuthJson(request);
	if (auth instanceof Response) return auth;

	const user = auth.user;

	try {
		// Admin/coordinator: full list with institution codes
		if (user.role === "admin" || user.role === "coordinator") {
			const result = await institutions.list(user, {
				page: 1,
				perPage: 1000,
				sort: "name",
			});

			return Response.json(
				{
					// Same projection the old `fields: "id,name,district,code"`
					// asked for — no campus-lead id, capacity or timestamps in
					// the payload.
					institutions: result.items.map(({ id, name, district, code }) => ({
						id,
						name,
						district,
						code,
					})),
				},
				{
					status: 200,
					headers: {
						// Role-dependent response under one URL: a shared/CDN cache
						// would hand an admin's full list (with codes) to a lead, or
						// vice versa. Keep it private to the authenticated client.
						"Cache-Control": "private, max-age=60",
					},
				},
			);
		}

		// Other authenticated roles: return only their own institution, no code.
		// The repository's §6.2 predicate already limits this to the actor's
		// own institution, so a missing row means "no institution on file".
		const institution = await institutions.getOne(user, user.institutionId);
		// A user with no institution on file is not an error — the endpoint
		// answers with an empty list.
		return Response.json(
			{
				institutions: institution
					? [{ id: institution.id, name: institution.name, district: institution.district }]
					: [],
			},
			{
				headers: { "Cache-Control": "private, max-age=60" },
			},
		);
	} catch (err) {
		console.error("[/api/institutions] failed:", err);
		return Response.json({ error: "Failed to fetch institutions." }, { status: 500 });
	}
}
