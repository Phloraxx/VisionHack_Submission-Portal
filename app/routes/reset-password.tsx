import { ArrowLeft, ArrowRight, KeyRound, Loader2, ShieldAlert } from "lucide-react";
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
import { AnimatedGrid } from "~/components/ui/animated-grid";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { clearAuthCookie } from "~/lib/auth.server";
import { db } from "~/lib/db.server";
import { getClientIp } from "~/lib/ip.server";
import { validateOrigin } from "~/lib/origin.server";
import { resetPassword, verifyPasswordResetToken } from "~/lib/password-reset.server";
import { checkRateLimit } from "~/lib/rate-limiter.server";

/** Minimum password length — matches the app's auth policy. */
const MIN_PASSWORD_LENGTH = 8;

export async function loader({ request }: LoaderFunctionArgs) {
	const token = new URL(request.url).searchParams.get("token") ?? "";
	const verified = token ? await verifyPasswordResetToken(db, token) : null;

	return data({
		valid: verified !== null,
		// Echoed into a hidden field so the action can re-verify. The token is
		// already in the URL, so this exposes nothing new.
		token: verified ? token : "",
	});
}

export async function action({ request }: ActionFunctionArgs) {
	try {
		validateOrigin(request, true);
	} catch {
		return data({ error: "Invalid request origin. Please try again." }, { status: 403 });
	}

	const formData = await request.formData();
	const token = String(formData.get("token") ?? "");
	const password = String(formData.get("password") ?? "");
	const confirmPassword = String(formData.get("confirmPassword") ?? "");

	// Rate limiting — same shape as the other auth surfaces.
	const ip = getClientIp(request);
	try {
		checkRateLimit(`reset:ip:${ip}`, 10, 60_000);
	} catch {
		return data({ error: "Too many attempts. Please try again later." }, { status: 429 });
	}

	if (password.length < MIN_PASSWORD_LENGTH) {
		return data(
			{ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
			{ status: 400 },
		);
	}
	if (password !== confirmPassword) {
		return data({ error: "Passwords do not match." }, { status: 400 });
	}

	const ok = await resetPassword(db, token, password);
	if (!ok) {
		return data(
			{ error: "This reset link is invalid or has expired. Request a new one." },
			{ status: 400 },
		);
	}

	// The old session (if any) belongs to the previous password — drop it.
	throw redirect("/login", { headers: { "Set-Cookie": clearAuthCookie() } });
}

export function meta() {
	return [{ title: "Choose a New Password — VisionHack 2026" }];
}

export default function ResetPassword() {
	const { valid, token } = useLoaderData() as { valid: boolean; token: string };
	const actionData = useActionData() as { error?: string } | undefined;
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
				<AnimatedGrid
					cellSize={16}
					numCells={32}
					maxOpacity={0.08}
					lineOpacity={0.1}
					lineColor="oklch(0.18 0.012 60)"
					cellColor="oklch(0.62 0.165 50)"
				/>

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
							Choose a new
							<br />
							<span className="text-primary">password.</span>
						</h1>
						<p className="max-w-md text-sm text-foreground/60 leading-relaxed">
							Pick something you have not used before. You will be signed out everywhere and can
							sign in again with the new password.
						</p>
					</div>

					<div className="rounded-md border border-border bg-background/70 p-5">
						<p className="mb-3 text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/40">
							Good to know
						</p>
						<ul className="space-y-2 text-sm text-foreground/70">
							<li className="flex items-start gap-3">
								<span className="mt-0.5 flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
								At least {MIN_PASSWORD_LENGTH} characters.
							</li>
							<li className="flex items-start gap-3">
								<span className="mt-0.5 flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
								The reset link works once and expires in 30 minutes.
							</li>
							<li className="flex items-start gap-3">
								<span className="mt-0.5 flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
								Your team, submissions and status stay exactly as they are.
							</li>
						</ul>
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
				style={{ backgroundColor: "#2e2a25" }}
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
						{valid ? (
							<>
								<div className="mb-10">
									<h2 className="text-2xl font-semibold tracking-tight text-sidebar-foreground">
										Set a new password
									</h2>
									<p className="mt-2 text-sm text-sidebar-foreground/50">
										Enter it twice to confirm.
									</p>
								</div>

								<Form method="post" className="space-y-5">
									<input type="hidden" name="token" value={token} />

									{actionData?.error && (
										<div
											role="alert"
											className="vh-shake rounded-md border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger"
										>
											{actionData.error}
										</div>
									)}

									<div className="space-y-2">
										<Label
											htmlFor="password"
											className="text-xs font-medium text-sidebar-foreground/70"
										>
											New password
										</Label>
										<div className="relative">
											<KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sidebar-foreground/40" />
											<Input
												id="password"
												name="password"
												type="password"
												placeholder="········"
												className="h-10 pl-9 vh-touch-row"
												autoComplete="new-password"
												minLength={MIN_PASSWORD_LENGTH}
												required
											/>
										</div>
									</div>

									<div className="space-y-2">
										<Label
											htmlFor="confirmPassword"
											className="text-xs font-medium text-sidebar-foreground/70"
										>
											Confirm new password
										</Label>
										<div className="relative">
											<KeyRound className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-sidebar-foreground/40" />
											<Input
												id="confirmPassword"
												name="confirmPassword"
												type="password"
												placeholder="········"
												className="h-10 pl-9 vh-touch-row"
												autoComplete="new-password"
												minLength={MIN_PASSWORD_LENGTH}
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
												Saving password
											</>
										) : (
											<>
												Save password
												<ArrowRight className="ml-2 h-4 w-4" />
											</>
										)}
									</Button>
								</Form>
							</>
						) : (
							<div className="page-enter">
								<div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-md bg-danger/15 text-danger">
									<ShieldAlert className="h-7 w-7" />
								</div>
								<h2 className="text-2xl font-semibold tracking-tight text-sidebar-foreground">
									Link expired
								</h2>
								<p className="mt-2 text-sm text-sidebar-foreground/50 leading-relaxed">
									This password reset link is invalid, already used, or older than 30 minutes.
									Request a fresh one to continue.
								</p>
								<Button asChild className="mt-8 w-full vh-touch" size="lg">
									<Link
										to="/forgot-password"
										className="inline-flex items-center justify-center gap-2"
									>
										Request a new link
										<ArrowRight className="h-4 w-4" />
									</Link>
								</Button>
							</div>
						)}

						<div className="mt-10 border-t border-sidebar-border pt-6">
							<Link
								to="/login"
								className="inline-flex items-center gap-1.5 text-sm text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
							>
								<ArrowLeft className="h-4 w-4" />
								Back to sign in
							</Link>
						</div>
					</div>
				</div>
			</main>
		</div>
	);
}
