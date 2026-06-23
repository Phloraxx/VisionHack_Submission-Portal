import { FileText, Loader2, ShieldCheck, Upload, UserPlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";
import {
	isRouteErrorResponse,
	useActionData,
	useLoaderData,
	useNavigation,
	useRouteError,
	useSubmit,
} from "react-router";
import { toast } from "sonner";
import { PanelHeader } from "~/components/shared/panel-header";
import { Skeleton } from "~/components/ui/skeleton";
import { Switch } from "~/components/ui/switch";
import { fail, ok, secureAction } from "~/lib/action.server";
import { getConfig } from "~/lib/config.server";
import { FEATURE_FLAGS } from "~/lib/feature-flags";
import { secureLoader } from "~/lib/loader.server";
import { configUpdateSchema } from "~/lib/schemas/config";

// Icons are presentation-only, so they live here (not in the shared,
// server-safe feature-flags module).
const FLAG_ICONS: Record<string, LucideIcon> = {
	registration_open: UserPlus,
	questionnaire_open: FileText,
	nomination_open: ShieldCheck,
	submission_open: Upload,
};

export const loader = secureLoader({ roles: ["admin"] }, async ({ user, pb }) => {
	const configMap = await getConfig(pb);
	return { user, configMap };
});
export const action = secureAction(
	{ roles: ["admin"], schema: configUpdateSchema },
	async ({ formData, pb, validated }) => {
		const { key } = validated as { key: string };

		if (!FEATURE_FLAGS.some((f) => f.key === key)) {
		return fail({ error: 'Invalid configuration key' });
		}

		// Config writes use the admin user's own auth token — the config
		// collection's create/update rules require @request.auth.role = "admin".
		const target = await pb
			.collection("config")
			.getFirstListItem(pb.filter("key = {:key}", { key }))
			.catch(() => null);
		if (!target) {
			return fail({ error: `Config key "${key}" not found`, status: 404 });
		}

		// Server-authoritative toggle: read the current value from the DB and flip it.
		// This eliminates the TOCTOU race where two admins clicking simultaneously
		// would both trust a stale client-side value.
		const currentValue = target.value === "true" || target.value === true;
		const newValue = !currentValue;

		await pb.collection("config").update(target.id, { value: newValue });
		return ok({ key, value: newValue });
	},
);

export function meta() {
	return [{ title: "Event Config — VisionHack" }];
}

export default function AdminConfig() {
	const data = useLoaderData() as { configMap: Record<string, boolean> } | null | undefined;
	const navigation = useNavigation();
	const configMap = data?.configMap ?? {};
	const actionData = useActionData<{ key?: string; value?: boolean; error?: string }>();
	const submit = useSubmit();

	// Show toast after action completes
	useEffect(() => {
		if (actionData?.key) {
			const flag = FEATURE_FLAGS.find((f) => f.key === actionData.key);
			if (flag) {
				toast.success(`${flag.label} ${actionData.value ? "enabled" : "disabled"}`, {
					duration: 2000,
				});
			}
		} else if (actionData?.error) {
			toast.error(actionData.error, { duration: 3000 });
		}
	}, [actionData]);

	const handleToggle = (key: string) => {
		submit({ key, value: String(!configMap[key]) }, { method: "post" });
	};

	const submitting = (key: string) =>
		navigation.state === "submitting" && navigation.formData?.get("key") === key;

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
					const isLoading = submitting(flag.key);

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
									<p className="text-xs text-muted-foreground">{flag.description}</p>
								</div>
							</div>

							<Switch
								checked={isEnabled}
								onCheckedChange={() => handleToggle(flag.key)}
								disabled={isLoading}
								aria-label={`Toggle ${flag.label}`}
							/>
						</div>
					);
				})}
			</div>
		</div>
	);
}

export function ErrorBoundary() {
	const error = useRouteError();
	let message = "Something went wrong";
	let details = "An unexpected error occurred while loading this page.";

	if (isRouteErrorResponse(error)) {
		message = error.status === 404 ? "Page not found" : `${error.status}: ${error.statusText}`;
		details = error.data?.message || details;
	} else if (import.meta.env.DEV && error instanceof Error) {
		details = error.message;
	}

	return (
		<div className="flex min-h-[50vh] items-center justify-center p-8">
			<div className="mx-auto max-w-md text-center">
				<p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-destructive">
					Error
				</p>
				<h1 className="mb-2 text-xl font-semibold tracking-tight">{message}</h1>
				<p className="text-sm text-muted-foreground">{details}</p>
				<button
					type="button"
					onClick={() => window.location.reload()}
					className="mt-6 inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
				>
					Try again
				</button>
			</div>
		</div>
	);
}
