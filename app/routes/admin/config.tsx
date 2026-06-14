import { useRef } from "react";
import { useLoaderData, Form } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import { validateOrigin } from "~/lib/csrf.server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Switch } from "~/components/ui/switch";
import {
  UserPlus,
  FileText,
  ShieldCheck,
  Upload,
  Info,
} from "lucide-react";

interface ConfigRecord {
  id: string;
  key: string;
  value: boolean;
}

const FEATURE_FLAGS = [
  {
    key: "registration_open",
    label: "Team Registration",
    description: "Allow Campus Leads to invite new Team Leads.",
    Icon: UserPlus,
  },
  {
    key: "questionnaire_open",
    label: "Questionnaire",
    description: "Allow Teams to submit or edit their questionnaire.",
    Icon: FileText,
  },
  {
    key: "nomination_open",
    label: "Team Nomination (Approval)",
    description: "Allow Campus Leads to Approve (Shortlist) teams.",
    Icon: ShieldCheck,
  },
  {
    key: "submission_open",
    label: "Idea Submission",
    description: "Allow Team Leads to submit their ideas.",
    Icon: Upload,
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireRole(request, ["admin"]);
  const pb = await createSuperuserClient();

  const configs = await pb
    .collection("config")
    .getFullList<ConfigRecord>();

  const configMap: Record<string, boolean> = {};
  for (const c of configs) {
    configMap[c.key] = c.value;
  }

  return { user, configs, configMap };
}

export async function action({ request }: ActionFunctionArgs) {
  validateOrigin(request);
  await requireRole(request, ["admin"]);
  const pb = await createSuperuserClient();

  const formData = await request.formData();
  const key = formData.get("key") as string;
  const value = formData.get("value") === "true";

  // Find the existing config record for this key
  const configs = await pb
    .collection("config")
    .getFullList<ConfigRecord>();
  const target = configs.find((c) => c.key === key);

  if (!target) {
    return Response.json(
      { success: false, error: `Config key "${key}" not found` },
      { status: 404 },
    );
  }

  await pb.collection("config").update(target.id, { value });

  return Response.json({ success: true, key, value });
}

export function meta() {
  return [{ title: "Event Config — VisionHack" }];
}

export default function AdminConfig() {
  const { configMap } = useLoaderData() as {
    user: any;
    configs: ConfigRecord[];
    configMap: Record<string, boolean>;
  };

  // Refs for programmatic form submission from Switch onChange
  const formRefs = useRef<Record<string, HTMLFormElement | null>>({});

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Event Configuration
        </h1>
        <p className="mt-1 text-muted-foreground">
          Toggle event phases: registration, questionnaire, nomination, and submissions. Changes are saved immediately.
        </p>
      </div>

      <div className="grid gap-6 max-w-3xl">
        {FEATURE_FLAGS.map((flag) => {
          const Icon = flag.Icon;
          const isEnabled = configMap[flag.key] === true;

          return (
            <Card
              key={flag.key}
              className={`border-l-4 transition-all ${
                isEnabled ? "border-l-green-500" : "border-l-gray-300"
              }`}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <div className="space-y-1">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {flag.label}
                  </CardTitle>
                  <CardDescription>{flag.description}</CardDescription>
                </div>

                <Form
                  method="post"
                  ref={(el) => { formRefs.current[flag.key] = el; }}
                >
                  <input type="hidden" name="key" value={flag.key} />
                  <input
                    type="hidden"
                    name="value"
                    value={String(!isEnabled)}
                  />
                  <Switch
                    checked={isEnabled}
                    onCheckedChange={() => {
                      // Submit the form when the switch is toggled
                      formRefs.current[flag.key]?.requestSubmit();
                    }}
                    aria-label={`Toggle ${flag.label}`}
                  />
                </Form>
              </CardHeader>
              <CardContent>
                <div className="text-xs text-muted-foreground mt-2 flex items-start gap-2 bg-muted/50 p-3 rounded-md">
                  <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <p>
                    <strong>Enabled:</strong> Feature is active and accessible to
                    users.
                    <br />
                    <strong>Disabled:</strong> Feature is locked for all users.
                  </p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
