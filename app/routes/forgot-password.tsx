import { Form, useActionData, useNavigation, Link } from "react-router";
import type { ActionFunctionArgs } from "react-router";
import { createPocketBaseClient } from "~/lib/pocketbase.server";
import { validateOrigin } from "~/lib/csrf.server";
import { checkForgotPasswordRateLimit } from "~/lib/rate-limit.server";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Mail, ArrowLeft, Loader2, CheckCircle2 } from "lucide-react";

export async function action({ request }: ActionFunctionArgs) {
  validateOrigin(request);

  // Rate limiting: 3 forgot-password requests per minute per IP
  if (!checkForgotPasswordRateLimit(request)) {
    return { error: "Too many requests. Please wait a moment and try again." };
  }

  const formData = await request.formData();
  const email = formData.get("email") as string;

  if (!email?.trim()) {
    return { error: "Email is required." };
  }

  const pb = createPocketBaseClient();

  try {
    await pb.collection("users").requestPasswordReset(email.trim());
    return { sent: true };
  } catch {
    // Don't reveal whether the email exists — PocketBase throws on unknown email
    return { sent: true };
  }
}

export function meta() {
  return [{ title: "Forgot Password — VisionHack" }];
}

export default function ForgotPassword() {
  const actionData = useActionData() as
    | { sent?: boolean; error?: string }
    | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  if (actionData?.sent) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
        <Card size="sm" className="w-full max-w-sm">
          <CardContent className="py-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-600" />
            <CardTitle className="mb-2">Check your email</CardTitle>
            <CardDescription>
              If an account exists for that email, we've sent a password reset
              link. Check your inbox and spam folder.
            </CardDescription>
            <Link
              to="/login"
              className="mt-6 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to Sign In
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card size="sm" className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Forgot Password</CardTitle>
          <CardDescription>
            Enter your email address and we'll send you a reset link.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form method="post" className="space-y-4">
            {actionData?.error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
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

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Mail className="mr-2 h-4 w-4" />
              )}
              {isSubmitting ? "Sending…" : "Send Reset Link"}
            </Button>

            <div className="text-center">
              <Link
                to="/login"
                className="text-sm text-muted-foreground hover:text-foreground hover:underline"
              >
                Back to Sign In
              </Link>
            </div>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
