import { Form, useActionData, useNavigation, Link, useLoaderData } from "react-router";
import { data } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { createPocketBaseClient } from "~/lib/pocketbase.server";
import { validateOrigin, validateCsrfToken, generateCsrfToken, setCsrfCookie } from "~/lib/csrf.server";
import { checkRateLimit } from "~/lib/rate-limiter.server";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { EventMark, IdentityLockup } from "~/components/shared/event-mark";
import { ArrowLeft, Loader2, Mail, Inbox } from "lucide-react";


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
  const ip = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    ?? request.headers.get("CF-Connecting-IP")
    ?? "unknown";
  checkRateLimit(`forgot:ip:${ip}`, 10, 60_000);     // 10/min per IP
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
  const actionData = useActionData() as
    | { sent?: boolean; error?: string }
    | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div className="vh-min-h-screen-dynamic bg-background lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* LEFT panel — vertically centered identity + brief instructions */}
      <aside className="relative hidden md:flex flex-col justify-center overflow-hidden bg-sidebar p-8 text-sidebar-foreground md:p-10 lg:p-12 vh-safe-top vh-safe-left vh-safe-right">
        <div
          className="absolute -top-32 -right-32 h-[28rem] w-[28rem] rounded-full opacity-40 vh-wash-tr"
          aria-hidden="true"
        />

        <div className="relative space-y-6">
          <IdentityLockup tagline="Account recovery" />

          <div className="space-y-3">
            <h1 className="text-3xl font-semibold tracking-tight leading-[1.15] md:text-4xl">
              Get back in
              <br />
              <span className="text-primary">in two minutes.</span>
            </h1>
            <p className="max-w-md text-sm text-sidebar-foreground/70 leading-relaxed">
              Enter your email and we'll send a secure reset link.
            </p>
          </div>

          <ol className="space-y-2 text-sm">
            <li className="flex items-start gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-primary/20 text-primary font-mono text-[10px] font-semibold">1</span>
              <span className="text-sidebar-foreground/70">Enter your email</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-primary/20 text-primary font-mono text-[10px] font-semibold">2</span>
              <span className="text-sidebar-foreground/70">Click the reset link</span>
            </li>
            <li className="flex items-start gap-3">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-primary/20 text-primary font-mono text-[10px] font-semibold">3</span>
              <span className="text-sidebar-foreground/70">Choose a new password</span>
            </li>
          </ol>
        </div>

        <div className="absolute bottom-8 left-8 lg:left-12 text-xs text-sidebar-foreground/30">
          μLearn SCET · VisionHack v2
        </div>
      </aside>

      {/* RIGHT panel — form only, no redundant label */}
      <main className="flex vh-min-h-screen-dynamic flex-col bg-background">
        <div className="flex items-center justify-between border-b border-border bg-background px-5 py-4 md:hidden vh-safe-top">
          <EventMark size="sm" label="VisionHack" />
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-10 sm:px-6 sm:py-12 lg:px-12">
          <div className="w-full max-w-sm">
            {actionData?.sent ? (
              <div className="page-enter">
                <div className="mb-6 inline-flex h-12 w-12 items-center justify-center rounded-md bg-primary/12 text-primary">
                  <Inbox className="h-6 w-6" />
                </div>
                <h2 className="text-2xl font-semibold tracking-tight">Check your inbox</h2>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  If an account exists for that email, we sent a password reset link. It expires in 30 minutes.
                </p>
                <ul className="mt-6 space-y-2 text-xs text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                    Check your spam folder if it doesn't arrive in 2 minutes.
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="h-1 w-1 rounded-full bg-muted-foreground" />
                    The link is single-use and expires.
                  </li>
                </ul>
                <Link to="/login" className="mt-8 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
                  <ArrowLeft className="h-4 w-4" />
                  Back to sign in
                </Link>
              </div>
            ) : (
              <>
                <div className="mb-8">
                  <h2 className="text-2xl font-semibold tracking-tight">Recover access</h2>
                  <p className="mt-1.5 text-sm text-muted-foreground">
                    Enter your email and we'll send you a reset link.
                  </p>
                </div>

                <Form method="post" className="space-y-4">
                  <input type="hidden" name="csrf_token" value={csrfToken} />
                  {actionData?.error && (
                    <div role="alert" className="vh-shake rounded-md border border-danger/30 bg-danger/8 px-3 py-2.5 text-sm text-danger">
                      {actionData.error}
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor="email" className="text-xs font-medium">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input id="email" name="email" type="email" placeholder="you@example.com" className="pl-9 vh-touch-row" autoComplete="email" required />
                    </div>
                  </div>

                  <Button type="submit" size="lg" className="w-full mt-2 vh-touch" disabled={isSubmitting}>
                    {isSubmitting ? (
                      <><Loader2 className="mr-2 h-4 w-4 vh-spin" /> Sending link</>
                    ) : (
                      "Send reset link"
                    )}
                  </Button>
                </Form>

                <div className="mt-8 border-t border-border pt-6">
                  <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
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
