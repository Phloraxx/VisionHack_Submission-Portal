import { ArrowRight, KeyRound, Loader2, Mail } from "lucide-react";
import {
	Form,
	Link,
	data,
	redirect,
	useActionData,
	useLoaderData,
	useNavigation,
} from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { EventMark } from "~/components/shared/event-mark";
import { AnimatedGrid } from "~/components/ui/animated-grid";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { ROLE_DASHBOARD_MAP, getAuthFromCookie, login, setAuthCookie } from "~/lib/auth.server";
import { getConfig } from "~/lib/config.server";
import { getClientIp } from "~/lib/ip.server";
import { validateOrigin } from "~/lib/origin.server";
import {
	createAuthenticatedClient,
	createPocketBaseClient,
	getAdminClient,
} from "~/lib/pocketbase.server";
import { checkRateLimit } from "~/lib/rate-limiter.server";
import type { UserRecord } from "~/lib/types";

export async function loader({ request }: LoaderFunctionArgs) {
	const token = getAuthFromCookie(request);
	if (token) {
		const pb = createAuthenticatedClient(token);
		try {
			await pb.collection("users").authRefresh();
			const user = pb.authStore.model as unknown as UserRecord | null;
			if (user?.role) {
				const target = ROLE_DASHBOARD_MAP[user.role as keyof typeof ROLE_DASHBOARD_MAP];
				if (!target) {
					throw new Response("No dashboard configured for your account role.", { status: 403 });
				}
				const headers = new Headers();
				headers.append("Set-Cookie", setAuthCookie(pb.authStore.token));
				throw redirect(target, { headers });
			}
		} catch (err) {
			if (err instanceof Response) throw err;
		}
	}

	const [cfg, adminPb] = await Promise.all([getConfig(createPocketBaseClient()), getAdminClient()]);
	const [teams, institutions] = await Promise.all([
		adminPb.collection("teams").getList(1, 1, { fields: "id" }),
		adminPb.collection("institutions").getList(1, 1, { fields: "id" }),
	]);

	return data({
		teamCount: teams.totalItems,
		institutionCount: institutions.totalItems,
		registrationOpen: !!cfg.registration_open,
		questionnaireOpen: !!cfg.questionnaire_open,
		submissionOpen: !!cfg.submission_open,
	});
}

export async function action({ request }: ActionFunctionArgs) {
	validateOrigin(request, true);

	const formData = await request.formData();
	const email = (formData.get("email") as string | null)?.trim()?.toLowerCase() ?? "";
	const password = (formData.get("password") as string | null) ?? "";

	if (!email || !password) {
		return data({ error: "Email and password are required." }, { status: 400 });
	}

	// Validate email format after confirming it's non-empty
	const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	if (!emailRegex.test(email)) {
		return data({ error: "Valid email is required." }, { status: 400 });
	}

	// App-level rate limiting
	const ip = getClientIp(request);
	checkRateLimit(`login:ip:${ip}`, 20, 60_000);
	checkRateLimit(`login:email:${email}`, 5, 60_000);

	try {
		const { token, record } = await login(email, password);
		// Guard against unmapped roles — redirecting to /login would loop.
		const dashboardPath = ROLE_DASHBOARD_MAP[record.role as keyof typeof ROLE_DASHBOARD_MAP];
		if (!dashboardPath) {
			return data(
				{ error: "Your account has no configured dashboard. Contact support." },
				{ status: 403 },
			);
		}
		const headers = new Headers();
		headers.append("Set-Cookie", setAuthCookie(token));
		throw redirect(dashboardPath, { headers });
	} catch (err) {
		// Re-throw redirects — they are not errors.
		if (err instanceof Response) throw err;
		// Mask the local part: keep the first char, replace the rest
		const masked = email.replace(/^(.).*?(@.*)$/, "$1***$2");
		console.error("[login] Auth failed for", masked);
		return data({ error: "Invalid email or password. Please try again." }, { status: 401 });
	}
}

export function meta() {
	return [
		{ title: "Sign In — VisionHack 2026" },
		{ name: "description", content: "Sign in to the VisionHack 2026 submission portal." },
	];
}
interface PhaseIndicatorProps {
	registrationOpen: boolean;
	questionnaireOpen: boolean;
	submissionOpen: boolean;
}

function PhaseIndicator({
	registrationOpen,
	questionnaireOpen,
	submissionOpen,
}: PhaseIndicatorProps) {
	const phase = (() => {
		if (registrationOpen)
			return { dot: "bg-success", label: "Registration is live", detail: "New teams can sign up" };
		if (questionnaireOpen)
			return {
				dot: "bg-info",
				label: "Registration closed",
				detail: "Questionnaire phase in progress",
			};
		if (submissionOpen)
			return {
				dot: "bg-warning",
				label: "Submissions open",
				detail: "Shortlisted teams submit ideas",
			};
		return { dot: "bg-muted-foreground", label: "Event closed", detail: "All phases complete" };
	})();
	return (
		<div className="rounded-md border border-border bg-background/70 p-5">
			<p className="mb-3 text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/40">
				Event Phase
			</p>
			<div className="flex items-center gap-3">
				<span className="relative flex h-2 w-2 shrink-0">
					<span className={`absolute inset-0 vh-pulse-dot rounded-full ${phase.dot}/60`} />
					<span className={`relative inline-flex h-2 w-2 rounded-full ${phase.dot}`} />
				</span>
				<div className="flex-1 min-w-0">
					<p className="text-sm font-medium text-foreground">{phase.label}</p>
					<p className="text-xs text-foreground/50">{phase.detail}</p>
				</div>
			</div>
		</div>
	);
}

export default function Login() {
	const { teamCount, institutionCount, registrationOpen, questionnaireOpen, submissionOpen } =
		useLoaderData() as {
			teamCount: number;
			institutionCount: number;
			registrationOpen: boolean;
			questionnaireOpen: boolean;
			submissionOpen: boolean;
		};
	const actionData = useActionData<{ error?: string }>();
	const navigation = useNavigation();
	const isSubmitting = navigation.state === "submitting";

	return (
		<div className="vh-min-h-screen-dynamic bg-sidebar md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
			{/* ----------------------------------------------------------------
          LEFT — Light identity panel
          ---------------------------------------------------------------- */}
			<aside
				data-theme="light"
				className="relative hidden md:flex flex-col overflow-hidden bg-background p-10 text-foreground border-r border-black/10 lg:p-12 xl:p-16"
			>
				{/* Grid: dark amber lines on warm paper */}
				<AnimatedGrid
					cellSize={16}
					numCells={32}
					maxOpacity={0.08}
					lineOpacity={0.1}
					lineColor="oklch(0.18 0.012 60)"
					cellColor="oklch(0.62 0.165 50)"
				/>

				{/* Logo — prominent, full colour, no tagline clutter */}
				<div className="relative z-10">
					<img
						src="/logo.svg"
						alt="μLearn SCET · VisionHack 2026"
						className="w-56 h-auto lg:w-64"
					/>
				</div>

				<div className="relative z-10 mt-12 space-y-6 lg:mt-16 lg:space-y-8">
					<div className="space-y-3">
						<h1
							className="text-3xl font-semibold tracking-tight leading-[1.1] text-foreground md:text-4xl lg:text-4xl xl:text-5xl"
							style={{ textWrap: "balance" }}
						>
							Build something real.
							<br />
							<span className="text-primary">Show it here.</span>
						</h1>
						<p className="max-w-md text-sm text-foreground/60 leading-relaxed">
							The submission portal for teams, campus leads, and reviewers running VisionHack 2026.
							Register your team, submit your idea, track your progress across the event.
						</p>
					</div>

					{/* Phase indicator */}
					<PhaseIndicator
						registrationOpen={registrationOpen}
						questionnaireOpen={questionnaireOpen}
						submissionOpen={submissionOpen}
					/>

					{/* Quick stats */}
					<div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border">
						<div className="bg-background px-5 py-4">
							<p className="font-mono text-lg font-semibold tabular-nums text-foreground sm:text-xl">
								{teamCount}
							</p>
							<p className="mt-0.5 text-[10px] uppercase tracking-wider text-foreground/50">
								Teams
							</p>
						</div>
						<div className="bg-background px-5 py-4">
							<p className="font-mono text-lg font-semibold tabular-nums text-foreground sm:text-xl">
								{institutionCount}
							</p>
							<p className="mt-0.5 text-[10px] uppercase tracking-wider text-foreground/50">
								Campuses
							</p>
						</div>
					</div>
				</div>

				<div className="relative z-10 mt-auto flex items-center justify-between border-t border-border/60 pt-5 text-xs text-foreground/40">
					<span>μLearn SCET · VisionHack</span>
					<span className="hidden sm:inline">v2.0 · 2026</span>
				</div>
			</aside>

			{/* ----------------------------------------------------------------
          RIGHT — Dark form panel
          ---------------------------------------------------------------- */}
			<main
				data-theme="dark"
				className="flex vh-min-h-screen-dynamic flex-col md:min-h-0"
				style={{ backgroundColor: "var(--sidebar)" }}
			>
				{/* Safe-area spacer — notch devices */}
				<div className="vh-safe-top md:hidden bg-sidebar" aria-hidden="true" />
				{/* Mobile brand bar */}
				<div className="flex items-center justify-between border-b border-sidebar-border bg-sidebar px-5 py-4 md:hidden">
					<img src="/logo.svg" alt="μLearn SCET · VisionHack 2026" className="h-7 w-auto" />
					<span className="font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/50">
						2026 · Submission Portal
					</span>
				</div>

				<div className="flex flex-1 items-start justify-center px-5 pt-8 pb-10 sm:px-6 sm:pt-10 sm:pb-12 md:items-center md:pt-0 lg:px-12">
					<div className="w-full max-w-sm">
						<div className="mb-10">
							<h2 className="text-2xl font-semibold tracking-tight text-sidebar-foreground">
								Welcome back
							</h2>
							<p className="mt-2 text-sm text-sidebar-foreground/50">
								Use the credentials from your invite email.
							</p>
						</div>

						<Form method="post" className="space-y-5">
							{actionData?.error && (
								<div
									role="alert"
									className="vh-shake rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
								>
									{actionData.error}
								</div>
							)}

							<div className="space-y-2">
								<Label htmlFor="email" className="text-xs font-medium text-sidebar-foreground/70">
									Email
								</Label>
								<div className="relative">
									<Mail className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sidebar-foreground/40" />
									<Input
										id="email"
										name="email"
										type="email"
										placeholder="you@example.com"
										className="h-10 pl-9 vh-touch-row"
										autoComplete="email"
										required
									/>
								</div>
							</div>

							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<Label
										htmlFor="password"
										className="text-xs font-medium text-sidebar-foreground/70"
									>
										Password
									</Label>
									<Link
										to="/forgot-password"
										className="text-xs text-sidebar-foreground/40 hover:text-sidebar-primary transition-colors vh-touch inline-flex items-center px-1 -mx-1"
									>
										Forgot?
									</Link>
								</div>
								<div className="relative">
									<KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sidebar-foreground/40" />
									<Input
										id="password"
										name="password"
										type="password"
										placeholder="········"
										className="h-10 pl-9 vh-touch-row"
										autoComplete="current-password"
										required
									/>
								</div>
							</div>

							<Button
								type="submit"
								size="lg"
								className="w-full mt-6 vh-touch"
								disabled={isSubmitting}
							>
								{isSubmitting ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 vh-spin" />
										Signing in
									</>
								) : (
									<>
										Sign in
										<ArrowRight className="ml-2 h-4 w-4" />
									</>
								)}
							</Button>
						</Form>

						<div className="mt-10 border-t border-sidebar-border pt-6">
							<p className="text-xs text-sidebar-foreground/40">
								Don't have an account?{" "}
								<span className="text-sidebar-foreground/80 font-medium">Ask your campus lead</span>{" "}
								to invite your team.
							</p>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}
