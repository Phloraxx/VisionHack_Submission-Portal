import type { LoaderFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import type { InstitutionRecord } from "~/lib/types";

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const auth = await requireAuthJson(request);
  if (auth instanceof Response) return auth;

  // We use the superuser client here so the response is consistent
  // regardless of the requesting user's role. The API rule on
  // `institutions` already restricts direct PB access, and the auth
  // check above gates the route.
  const pb = createSuperuserClient();

  try {
    const institutions = await pb
      .collection("institutions")
      .getFullList<InstitutionRecord>({
        sort: "name",
        fields: "id,name,district,code",
      });

    return Response.json(
      { institutions },
      {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=120",
        },
      },
    );
  } catch (err) {
    console.error("[/api/institutions] failed:", err);
    return Response.json(
      { error: "Failed to fetch institutions." },
      { status: 500 },
    );
  }
}
