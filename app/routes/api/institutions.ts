import type { LoaderFunctionArgs } from "react-router";
import { requireAuthJson } from "~/lib/auth.server";
import type { InstitutionRecord } from "~/lib/types";

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const auth = await requireAuthJson(request);
  if (auth instanceof Response) return auth;

  // Use the requesting user's own auth token. The institutions list rule
  // (`@request.auth.id != ""`) allows any authenticated user.
  const pb = auth.pb;

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
