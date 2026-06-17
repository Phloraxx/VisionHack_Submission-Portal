import { useRef, useState } from "react";
import { useLoaderData, Form } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import { secureAction, fail, ok } from "~/lib/action.server";
import { getConfig } from "~/lib/config.server";
import { FEATURE_FLAGS } from "~/lib/feature-flags";
import { Switch } from "~/components/ui/switch";
import { toast } from "sonner";
import {
  UserPlus,
  FileText,
  ShieldCheck,
  Upload,
  Loader2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { PanelHeader } from "~/components/shared/panel-header";

// Icons are presentation-only, so they live here (not in the shared,
// server-safe feature-flags module).
const FLAG_ICONS: Record<string, LucideIcon> = {
  registration_open: UserPlus,
  questionnaire_open: FileText,
  nomination_open: ShieldCheck,
  submission_open: Upload,
};

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireRole(request, ["admin"]);
  const pb = createSuperuserClient();
  const configMap = await getConfig(pb);
  return { user, configMap };
}

export const action = secureAction(
  { roles: ["admin"] },
  async ({ formData }) => {
    const key = (formData.get("key") as string | null) ?? "";
    const value = formData.get("value") === "true";

    if (!FEATURE_FLAGS.some((f) => f.key === key)) {
      return fail({ error: `Unknown config key "${key}"`, status: 400 });
    }

    // Config writes require superuser — the `config` collection has null
    // create/update rules (server-side only).
    const pb = createSuperuserClient();
    const target = await pb
      .collection("config")
      .getFirstListItem(pb.filter("key = {:key}", { key }))
      .catch(() => null);
    if (!target) {
      return fail({ error: `Config key "${key}" not found`, status: 404 });
    }

    await pb.collection("config").update(target.id, { value });
    return ok({ key, value });
  },
);

export function meta() {
  return [{ title: "Event Config — VisionHack" }];
}

export default function AdminConfig() {
  const { configMap } = useLoaderData() as {
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
    <div className="space-y-10">
      <PanelHeader
        eyebrow="Event"
        title="Configuration"
        description="Toggle phases on or off. Changes are saved immediately."
      />

      <div className="max-w-lg space-y-1">
        {FEATURE_FLAGS.map((flag) => {
          const Icon = FLAG_ICONS[flag.key] ?? UserPlus;
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
                    <Loader2 className="h-4 w-4 vh-spin" />
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
