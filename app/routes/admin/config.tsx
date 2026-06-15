import { useRef, useState } from "react";
import { useLoaderData, Form } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import { validateOrigin } from "~/lib/csrf.server";
import { Switch } from "~/components/ui/switch";
import { toast } from "sonner";
import {
  UserPlus,
  FileText,
  ShieldCheck,
  Upload,
  Loader2,
} from "lucide-react";

interface ConfigRecord {
  id: string;
  key: string;
  value: boolean;
}

const FEATURE_FLAGS = [
  {
    key: "registration_open",
    label: "Registration",
    description: "Campus leads can invite team leads",
    Icon: UserPlus,
    step: 1,
  },
  {
    key: "questionnaire_open",
    label: "Questionnaire",
    description: "Teams can submit their questionnaire",
    Icon: FileText,
    step: 2,
  },
  {
    key: "nomination_open",
    label: "Nomination",
    description: "Campus leads can shortlist teams",
    Icon: ShieldCheck,
    step: 3,
  },
  {
    key: "submission_open",
    label: "Submission",
    description: "Teams can submit their ideas",
    Icon: Upload,
    step: 4,
  },
];

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireRole(request, ["admin"]);
  const pb = createSuperuserClient();

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
  const pb = createSuperuserClient();

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

  const formRefs = useRef<Record<string, HTMLFormElement | null>>({});
  const [toggling, setToggling] = useState<string | null>(null);

  const handleToggle = (key: string, label: string, checked: boolean) => {
    setToggling(key);
    toast.success(`${label} ${checked ? "enabled" : "disabled"}`, {
      duration: 1500,
    });
    formRefs.current[key]?.requestSubmit();
    setTimeout(() => setToggling(null), 600);
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Event Configuration
        </h1>
        <p className="mt-1 text-muted-foreground">
          Toggle phases on or off. Changes are saved immediately.
        </p>
      </div>

      <div className="max-w-lg space-y-1">
        {FEATURE_FLAGS.map((flag) => {
          const Icon = flag.Icon;
          const isEnabled = configMap[flag.key] === true;
          const isLoading = toggling === flag.key;

          return (
            <div
              key={flag.key}
              className="flex items-center justify-between rounded-lg px-4 py-3 transition-colors hover:bg-muted/50"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-card text-muted-foreground">
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium">{flag.label}</p>
                  <p className="text-xs text-muted-foreground">
                    {flag.description}
                  </p>
                </div>
              </div>

              <Form
                method="post"
                ref={(el) => {
                  formRefs.current[flag.key] = el;
                }}
              >
                <input type="hidden" name="key" value={flag.key} />
                <input type="hidden" name="value" value={String(!isEnabled)} />
                <Switch
                  checked={isEnabled}
                  onCheckedChange={(checked) =>
                    handleToggle(flag.key, flag.label, checked)
                  }
                  disabled={isLoading}
                  aria-label={`Toggle ${flag.label}`}
                />
              </Form>
            </div>
          );
        })}
      </div>
    </div>
  );
}
