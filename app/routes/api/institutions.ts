import type { LoaderFunctionArgs } from "react-router";
import { requireAuth } from "~/lib/auth.server";
import type { InstitutionRecord } from "~/lib/types";

export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { pb } = await requireAuth(request);

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
  } catch {
    return Response.json(
      { error: "Failed to fetch institutions." },
      { status: 500 },
    );
  }
}
