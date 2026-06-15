import {
  Form,
  useActionData,
  useNavigation,
  Link,
  redirect,
} from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { getAuthFromCookie, login, setAuthCookie, ROLE_DASHBOARD_MAP } from "~/lib/auth.server";
import { createAuthenticatedClient } from "~/lib/pocketbase.server";
import { validateOrigin } from "~/lib/csrf.server";
import { checkLoginRateLimit } from "~/lib/rate-limit.server";
import type { UserRecord } from "~/lib/types";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { PageTransition } from "~/components/shared/page-transition";

export async function loader({ request }: LoaderFunctionArgs) {
  // If already authenticated, redirect to dashboard
  const token = getAuthFromCookie(request);
  if (token) {
    const pb = createAuthenticatedClient(token);
    try {
      await pb.collection("users").authRefresh();
      const user = pb.authStore.model as unknown as UserRecord | null;
      if (user?.role) {
        throw redirect(ROLE_DASHBOARD_MAP[user.role]);
      }
    } catch {
      // Invalid token — proceed to login
    }
  }
}

export async function action({ request }: ActionFunctionArgs) {
  validateOrigin(request);

  // Rate limiting: 10 login attempts per minute per IP
  if (!checkLoginRateLimit(request)) {
    return { error: "Too many login attempts. Please wait a moment and try again." };
  }

  const formData = await request.formData();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  // Only catch auth failures — the redirect must NOT be inside try/catch
  // because Vite SSR bundles Response from a different realm, breaking instanceof.
  let token: string;
  let role: string;
  try {
    const result = await login(email, password);
    token = result.token;
    role = result.record.role;
  } catch (err) {
    // Don't log the full error object — it may contain sensitive data.
    // Log only the error type for debugging.
    const message = err instanceof Error ? err.message : String(err);
    console.error("[login] Auth failed:", message.slice(0, 200));
    return { error: "Invalid email or password. Please try again." };
  }

  const dashboardPath = ROLE_DASHBOARD_MAP[role as keyof typeof ROLE_DASHBOARD_MAP] || "/login";
  const headers = new Headers();
  headers.append("Set-Cookie", setAuthCookie(token));
  throw redirect(dashboardPath, { headers });
}

export function meta() {
  return [
    { title: "Sign In — VisionHack" },
    { name: "description", content: "Sign in to the VisionHack submission portal." },
  ];
}

export default function Login() {
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <PageTransition>
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card size="sm" className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign In</CardTitle>
          <CardDescription>
            Enter your credentials to access the VisionHack submission portal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-4">
            {actionData?.error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive animate-in fade-in slide-in-from-top-2 duration-200">
                {actionData.error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                required
                autoComplete="current-password"
              />
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? "Signing in…" : "Sign In"}
            </Button>

            <div className="text-center">
              <Link
                to="/forgot-password"
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                Forgot your password?
              </Link>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
    </PageTransition>
  );
}
