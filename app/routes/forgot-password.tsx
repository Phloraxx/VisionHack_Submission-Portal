import { ArrowLeft, ArrowRight, Inbox, Loader2, Mail } from "lucide-react";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { data } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { AnimatedGrid } from "~/components/ui/animated-grid";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	generateCsrfToken,
	setCsrfCookie,
	validateCsrfToken,
	validateOrigin,
} from "~/lib/csrf.server";
import { createPocketBaseClient } from "~/lib/pocketbase.server";
import { checkRateLimit } from "~/lib/rate-limiter.server";

export async function loader({ request }: LoaderFunctionArgs) {
	const csrfToken = generateCsrfToken();
	const headers = new Headers();
	headers.append("Set-Cookie", setCsrfCookie(csrfToken));
	return data({ csrfToken }, { headers });
}

export async function action({ request }: ActionFunctionArgs) {
	validateOrigin(request, true);

	const formData = await request.formData();
	validateCsrfToken(request, formData);
	const email = (formData.get("email") as string | null)?.trim()?.toLowerCase() ?? "";

	if (!email) {
		return data({ error: "Email is required." }, { status: 400 });
	}

	// Rate limiting
	const ip =
		request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
		request.headers.get("CF-Connecting-IP") ??
		"unknown";
	checkRateLimit(`forgot:ip:${ip}`, 10, 60_000); // 10/min per IP
	checkRateLimit(`forgot:email:${email}`, 3, 60_000); // 3/min per account

	const pb = createPocketBaseClient();

	// Always succeed (don't reveal whether the email exists). Origin and
	// CSRF token validation above prevent abuse.
	try {
		await pb.collection("users").requestPasswordReset(email);
	} catch {
		// Swallowed on purpose.
	}

	return data({ sent: true }, { status: 200 });
}

export function meta() {
	return [{ title: "Reset Password — VisionHack 2026" }];
}

export default function ForgotPassword() {
	const { csrfToken } = useLoaderData() as { csrfToken: string };
	const actionData = useActionData() as { sent?: boolean; error?: string } | undefined;
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
							Reset your
							<br />
							<span className="text-primary">password.</span>
						</h1>
						<p className="max-w-md text-sm text-foreground/60 leading-relaxed">
							Enter the email you used to register your team. We will send a secure link to create a
							new password.
						</p>
					</div>

					<div className="rounded-md border border-border bg-background/70 p-5">
						<p className="mb-3 text-[10px] font-medium uppercase tracking-[0.2em] text-foreground/40">
							What happens next
						</p>
						<ul className="space-y-2 text-sm text-foreground/70">
							<li className="flex items-start gap-3">
								<span className="mt-0.5 flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
								Check your inbox for the reset link.
							</li>
							<li className="flex items-start gap-3">
								<span className="mt-0.5 flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
								The link is single-use and expires in 30 minutes.
							</li>
							<li className="flex items-start gap-3">
								<span className="mt-0.5 flex h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
								No account? The request still looks the same for privacy.
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

				<div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-6 sm:py-12 lg:px-12">
					<div className="w-full max-w-sm">
						{actionData?.sent ? (
							<div className="page-enter">
								<div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-md bg-primary/15 text-primary">
									<Inbox className="h-7 w-7" />
								</div>
								<h2 className="text-2xl font-semibold tracking-tight text-sidebar-foreground">
									Check your inbox
								</h2>
								<p className="mt-2 text-sm text-sidebar-foreground/50 leading-relaxed">
									If an account exists for that email, we sent a password reset link. It expires in
									30 minutes.
								</p>
								<ul className="mt-6 space-y-2 text-xs text-sidebar-foreground/40">
									<li className="flex items-center gap-2">
										<span className="h-1 w-1 rounded-full bg-sidebar-foreground/40" />
										Check your spam folder if it does not arrive in 2 minutes.
									</li>
									<li className="flex items-center gap-2">
										<span className="h-1 w-1 rounded-full bg-sidebar-foreground/40" />
										The link is single-use and expires.
									</li>
								</ul>
								<Button asChild className="mt-8 w-full vh-touch" size="lg">
									<Link to="/login" className="inline-flex items-center justify-center gap-2">
										<ArrowLeft className="h-4 w-4" />
										Back to sign in
									</Link>
								</Button>
							</div>
						) : (
							<>
								<div className="mb-10">
									<h2 className="text-2xl font-semibold tracking-tight text-sidebar-foreground">
										Recover access
									</h2>
									<p className="mt-2 text-sm text-sidebar-foreground/50">
										Enter your email and we will send you a reset link.
									</p>
								</div>

								<Form method="post" className="space-y-5">
									<input type="hidden" name="csrf_token" value={csrfToken} />
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
											htmlFor="email"
											className="text-xs font-medium text-sidebar-foreground/70"
										>
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

									<Button
										type="submit"
										size="lg"
										className="w-full mt-6 vh-touch"
										disabled={isSubmitting}
									>
										{isSubmitting ? (
											<>
												<Loader2 className="mr-2 h-4 w-4 vh-spin" />
												Sending link
											</>
										) : (
											<>
												Send reset link
												<ArrowRight className="ml-2 h-4 w-4" />
											</>
										)}
									</Button>
								</Form>

								<div className="mt-10 border-t border-sidebar-border pt-6">
									<Link
										to="/login"
										className="inline-flex items-center gap-1.5 text-sm text-sidebar-foreground/40 hover:text-sidebar-foreground transition-colors"
									>
										<ArrowLeft className="h-4 w-4" />
										Back to sign in
									</Link>
								</div>
							</>
						)}
					</div>
				</div>
			</main>
		</div>
	);
}
