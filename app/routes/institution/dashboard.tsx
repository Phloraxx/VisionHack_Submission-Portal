import { useState, useEffect, useRef } from "react";
import { useLoaderData, Form, useNavigation, useActionData, Link } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { validateOrigin } from "~/lib/csrf.server";
import { getConfig } from "~/lib/config.server";
import { sendEmail } from "~/lib/email.server";
import {
  STATUS_LABELS,
  STATUS_COLORS,
} from "~/lib/team-status";
import { canTransition } from "~/lib/types";
import type { TeamStatus, Role, InstitutionRecord, MemberRecord } from "~/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Badge } from "~/components/ui/badge";
import {
  Users,
  CheckCircle,
  Lock,
  UserPlus,
  Mail,
  ChevronDown,
  ChevronUp,
  Check,
  X,
  Building2,
  ClipboardList,
  Lightbulb,
  Loader2,
} from "lucide-react";
import { generateSecurePassword } from "~/lib/password";
import { escapeHtml } from "~/lib/utils";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Reuse InstitutionRecord from central types (extra fields ignored by PocketBase)
type Institution = InstitutionRecord;

interface TeamWithExpand {
  id: string;
  name: string;
  teamCode: string;
  status: TeamStatus;
  created: string;
  institutionId: string;
  leaderUserId: string;
  expand?: {
    institutionId?: { name: string };
    leaderUserId?: { name: string; email: string };
  };
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  const { pb, user } = await requireRole(request, ["institution"]);

  const institutions = await pb
    .collection("institutions")
    .getFullList<Institution>();

  const institution = institutions.find(
    (inst) => inst.campusLeadId === user.id,
  );

  if (!institution) {
    throw new Response("Institution not found for this user", { status: 404 });
  }

  const teams = await pb.collection("teams").getFullList<TeamWithExpand>({
    filter: pb.filter('institutionId = {:institutionId}', { institutionId: institution.id }),
    expand: "leaderUserId",
    sort: "-created",
  });

  // Fetch members for all institution teams
  const allMembers = await pb.collection("members").getFullList<MemberRecord>({
    filter: teams.length > 0
      ? pb.filter(
          teams.map((t) => `teamId = "${t.id}"`).join(" || "),
        )
      : "id = ''",
  });
  const membersByTeam: Record<string, MemberRecord[]> = {};
  for (const m of allMembers) {
    if (!membersByTeam[m.teamId]) membersByTeam[m.teamId] = [];
    membersByTeam[m.teamId].push(m);
  }

  const flags = await getConfig(pb);
  const config = flags.nomination_open ?? false;

  return {
    user,
    institution,
    teams,
    membersByTeam,
    nominationOpen: config,
  };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  validateOrigin(request);
  const { pb, user } = await requireRole(request, ["institution"]);
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  const institutions = await pb
    .collection("institutions")
    .getFullList<Institution>();
  const institution = institutions.find(
    (inst) => inst.campusLeadId === user.id,
  );
  if (!institution) {
    return Response.json({ error: "Institution not found" }, { status: 404 });
  }

  switch (intent) {
    case "invite-lead": {
      const name = formData.get("name") as string;
      const email = formData.get("email") as string;
      const lowerEmail = email.toLowerCase().trim();

      if (!name || !email) {
        return Response.json({ error: "Name and email are required" }, { status: 400 });
      }

      // Enforce max teams limit
      const existingTeamsCount = await pb
        .collection("teams")
        .getFullList({ filter: pb.filter('institutionId = {:instId}', { instId: institution.id }) });
      if (existingTeamsCount.length >= (institution.maxTeams || 5)) {
        return Response.json(
          { error: `This institution has reached its maximum of ${institution.maxTeams || 5} teams.` },
          { status: 400 },
        );
      }

      // Check if a user with this email already exists
      const existingUsers = await pb
        .collection("users")
        .getFullList({ filter: pb.filter('email = {:email}', { email: lowerEmail }) });

      let leadUserId: string;

      if (existingUsers.length > 0) {
        leadUserId = existingUsers[0].id;
      } else {
        // Create user with a temporary random password.
        // The user will set their real password via the "Forgot Password" flow.
        // We NEVER send plaintext passwords in email.
        const password = generateSecurePassword();

        const newUser = await pb.collection("users").create({
          email: lowerEmail,
          password,
          passwordConfirm: password,
          name,
          role: "lead",
          institutionId: institution.id,
        });
        leadUserId = newUser.id;

        // Send invitation email — does NOT include the password.
        // User sets their password via the "Forgot Password" link on the login page.
        try {
          const htmlBody = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
              <h1 style="font-size: 20px; margin: 0 0 16px;">You're Invited to VisionHack 2026!</h1>
              <p style="margin: 0 0 12px; line-height: 1.6;">Hello <strong>${escapeHtml(name)}</strong>,</p>
              <p style="margin: 0 0 12px; line-height: 1.6;">
                You have been invited to participate in <strong>VisionHack 2026</strong> by
                <strong>${escapeHtml(institution.name)}</strong>.
              </p>
              <p style="margin: 0 0 16px; line-height: 1.6;">
                An account has been created for you. To get started:
              </p>
              <ol style="margin: 0 0 16px; padding-left: 20px; line-height: 1.8;">
                <li>Visit the <a href="https://visionhack.mulearn.org/login">VisionHack login page</a></li>
                <li>Click <strong>"Forgot your password?"</strong></li>
                <li>Enter your email (<code style="background: #e4e4e7; padding: 2px 6px; border-radius: 4px;">${escapeHtml(lowerEmail)}</code>)</li>
                <li>Check your inbox for a password reset link to set your password</li>
              </ol>
              <div style="text-align: center; margin: 16px 0;">
                <a href="https://visionhack.mulearn.org/login"
                   style="display: inline-block; background: #18181b; color: #fff; text-decoration: none; padding: 10px 24px; border-radius: 8px; font-size: 14px;">
                  Go to VisionHack Login
                </a>
              </div>
              <p style="margin: 0 0 4px; line-height: 1.6;">After setting your password, complete your team registration and submit your idea.</p>
              <hr style="border: none; border-top: 1px solid #e4e4e7; margin: 24px 0;" />
              <p style="margin: 0; font-size: 12px; color: #71717a;">Best regards,<br/>VisionHack Team</p>
            </div>
          `.trim();

          const result = await sendEmail({
            to: lowerEmail,
            subject: "You've been invited to VisionHack 2026!",
            html: htmlBody,
          });

          if (result.sent) {
            console.log(`Invitation email sent to ${lowerEmail}`);
          } else {
            console.error(`Failed to send invitation email to ${lowerEmail}`);
          }
        } catch {
          // Email failure shouldn't block the invite
          console.error("Failed to send invitation email");
        }
      }

      // Check if this lead already has a team under this institution
      const existingTeams = await pb.collection("teams").getFullList({
        filter: pb.filter('leaderUserId = {:leaderUserId} && institutionId = {:institutionId}', {
          leaderUserId: leadUserId,
          institutionId: institution.id,
        }),
      });
      if (existingTeams.length > 0) {
        return Response.json({ error: "A team already exists for this lead at your institution" }, { status: 409 });
      }

      // Create the team
      await pb.collection("teams").create({
        name: `${name}'s Team`,
        institutionId: institution.id,
        leaderUserId: leadUserId,
        status: "invited",
      });

      return Response.json({ success: true });
    }

    case "shortlist": {
      const teamId = formData.get("teamId") as string;
      const flags = await getConfig(pb);
      const nominationOpen = flags.nomination_open ?? false;
      if (!nominationOpen) {
        return Response.json({ error: "Shortlisting is currently closed" }, { status: 403 });
      }

      const team = await pb.collection("teams").getOne(teamId);

      // Ensure the team belongs to this institution — prevents IDOR
      if ((team as any).institutionId !== institution.id) {
        return Response.json({ error: "Team not found" }, { status: 404 });
      }

      if (!canTransition(team.status as TeamStatus, "shortlisted", "institution" as Role)) {
        return Response.json({ error: "Cannot shortlist this team from its current status" }, { status: 403 });
      }

      await pb.collection("teams").update(teamId, { status: "shortlisted" });
      return Response.json({ success: true });
    }

    case "unshortlist": {
      const teamId = formData.get("teamId") as string;
      const flags = await getConfig(pb);
      const nominationOpen = flags.nomination_open ?? false;
      if (!nominationOpen) {
        return Response.json({ error: "Shortlisting is currently closed" }, { status: 403 });
      }

      const team = await pb.collection("teams").getOne(teamId);

      // Ensure the team belongs to this institution — prevents IDOR
      if ((team as any).institutionId !== institution.id) {
        return Response.json({ error: "Team not found" }, { status: 404 });
      }

      if (!canTransition(team.status as TeamStatus, "registered", "institution" as Role)) {
        return Response.json({ error: "Cannot unshortlist this team" }, { status: 403 });
      }

      await pb.collection("teams").update(teamId, { status: "registered" });
      return Response.json({ success: true });
    }

    default:
      return Response.json({ error: "Unknown intent" }, { status: 400 });
  }
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export function meta() {
  return [{ title: "Institution Dashboard — VisionHack" }];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function InstitutionDashboard() {
  const { user, institution, teams, membersByTeam, nominationOpen } =
    useLoaderData() as {
      user: { id: string; name: string; email: string };
      institution: Institution;
      teams: TeamWithExpand[];
      membersByTeam: Record<string, MemberRecord[]>;
      nominationOpen: boolean;
    };
  const navigation = useNavigation();
  const actionData = useActionData() as { success?: boolean; error?: string } | undefined;
  const isSubmitting = navigation.state === "submitting";

  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());

  // Toasts for action feedback
  const prevSuccess = useRef(false);
  useEffect(() => {
    if (actionData?.success && !prevSuccess.current) {
      toast.success("Action completed successfully!");
    }
    prevSuccess.current = !!actionData?.success;
  }, [actionData?.success]);

  const prevError = useRef(actionData?.error);
  useEffect(() => {
    if (actionData?.error && actionData.error !== prevError.current) {
      toast.error(actionData.error);
    }
    prevError.current = actionData?.error;
  }, [actionData?.error]);

  const shortlistedCount = teams.filter(
    (t) => t.status === "shortlisted" || t.status === "submitted" || t.status === "selected",
  ).length;

  const toggleTeamExpansion = (teamId: string) => {
    setExpandedTeams((prev) => {
      const next = new Set(prev);
      if (next.has(teamId)) {
        next.delete(teamId);
      } else {
        next.add(teamId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Institution Dashboard
        </h1>
        <p className="text-muted-foreground">
          {user.name} &middot; <span className="font-medium">{institution.name}</span>
        </p>
        {institution.district && (
          <p className="text-sm text-muted-foreground">
            District: {institution.district}
          </p>
        )}
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-3 stagger-cards">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Users className="h-4 w-4" />
              Total Teams
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">{teams.length}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <CheckCircle className="h-4 w-4" />
              Shortlisted
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-bold">
              {shortlistedCount}/{institution.maxTeams || 5}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Building2 className="h-4 w-4" />
              Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2">
              {nominationOpen ? (
                <>
                  <CheckCircle className="h-5 w-5 text-emerald-600" />
                  <span className="font-semibold text-emerald-600">
                    Nomination Open
                  </span>
                </>
              ) : (
                <>
                  <Lock className="h-5 w-5 text-orange-600" />
                  <span className="font-semibold text-orange-600">
                    Nomination Closed
                  </span>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Invite Team Lead Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              Invite Team Lead
            </CardTitle>
            <CardDescription>
              Enter the name and email of a team lead to invite them to the
              platform.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invite-name">Full Name</Label>
              <Input
                id="invite-name"
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Enter team lead name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email Address</Label>
              <Input
                id="invite-email"
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="Enter email address"
              />
            </div>
            <Form method="post">
              <input type="hidden" name="intent" value="invite-lead" />
              <input type="hidden" name="name" value={inviteName} />
              <input type="hidden" name="email" value={inviteEmail} />
              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting || !inviteName.trim() || !inviteEmail.trim()}
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Mail className="mr-2 h-4 w-4" />
                )}
                {isSubmitting
                  ? "Inviting..."
                  : "Invite Team Lead"}
              </Button>
            </Form>
          </CardContent>
        </Card>

        {/* How It Works */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ClipboardList className="h-5 w-5" />
              How It Works
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  1
                </div>
                <div>
                  <h4 className="font-semibold">Add Team Lead Details</h4>
                  <p className="text-sm text-muted-foreground">
                    Enter the name and email of each team lead
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  2
                </div>
                <div>
                  <h4 className="font-semibold">Accounts Created Automatically</h4>
                  <p className="text-sm text-muted-foreground">
                    System creates accounts with auto-generated passwords
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  3
                </div>
                <div>
                  <h4 className="font-semibold">Email Sent with Credentials</h4>
                  <p className="text-sm text-muted-foreground">
                    Each team lead receives their login details via email
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                  4
                </div>
                <div>
                  <h4 className="font-semibold">Team Leads Access Portal</h4>
                  <p className="text-sm text-muted-foreground">
                    They can log in and register their teams for the hackathon
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 rounded-lg bg-blue-50 p-4 text-sm text-blue-800 dark:bg-blue-950 dark:text-blue-200">
              <strong>Note:</strong> You can invite as many teams as you want,
              but you can only shortlist up to {institution.maxTeams || 5} teams
              for the final submission.
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Teams List */}
      {teams.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              Teams ({teams.length})
            </CardTitle>
            <CardDescription>
              All teams registered under your institution
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {teams.map((team) => {
                const isExpanded = expandedTeams.has(team.id);
                const colors = STATUS_COLORS[team.status] ?? STATUS_COLORS.invited;

                return (
                  <div
                    key={team.id}
                    className="rounded-lg border bg-card card-hover"
                  >
                    <div
                      className="flex cursor-pointer items-start justify-between p-4"
                      onClick={() => toggleTeamExpansion(team.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          toggleTeamExpansion(team.id);
                        }
                      }}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                    >
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${colors.bg} ${colors.text}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${colors.dot}`}
                            />
                            {STATUS_LABELS[team.status] ?? team.status}
                          </span>
                        </div>
                        <p className="font-semibold">
                          {team.expand?.leaderUserId?.name ?? "Unknown"}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {team.expand?.leaderUserId?.email ?? ""}
                        </p>
                        {team.teamCode && (
                          <p className="font-mono text-xs text-muted-foreground">
                            Code: {team.teamCode}
                          </p>
                        )}
                        {team.name && (
                          <p className="text-sm">
                            <span className="font-medium text-foreground">
                              Team:
                            </span>{" "}
                            <span className="text-muted-foreground">
                              {team.name}
                            </span>
                          </p>
                        )}
                      </div>
                      <div className="ml-4">
                        {isExpanded ? (
                          <ChevronUp className="h-5 w-5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-5 w-5 text-muted-foreground" />
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="border-t bg-muted/30 px-4 pb-4 pt-3">
                        {/* Members */}
                        {membersByTeam[team.id]?.length > 0 && (
                          <div className="mb-3">
                            <p className="mb-1 text-xs font-medium text-muted-foreground">
                              Team Members ({membersByTeam[team.id].length})
                            </p>
                            <div className="space-y-1">
                              {membersByTeam[team.id].map((m) => (
                                <div
                                  key={m.id}
                                  className="flex items-center gap-2 rounded bg-background/50 px-2 py-1 text-xs"
                                >
                                  <span className="font-medium text-foreground">
                                    {m.fullName}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {m.email}
                                  </span>
                                  {m.role && (
                                    <span className="ml-auto text-muted-foreground">
                                      {m.role}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Shortlist/Unshortlist Actions */}
                        <div className="space-y-2">
                          {team.status === "registered" && (
                            <Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="shortlist"
                              />
                              <input
                                type="hidden"
                                name="teamId"
                                value={team.id}
                              />
                              <Button
                                type="submit"
                                size="sm"
                                className="w-full bg-emerald-600 hover:bg-emerald-700"
                                disabled={isSubmitting || !nominationOpen}
                              >
                                <Check className="mr-2 h-4 w-4" />
                                {nominationOpen
                                  ? "Shortlist Team"
                                  : "Nomination Closed"}
                              </Button>
                            </Form>
                          )}
                          {team.status === "shortlisted" && (
                            <Form method="post">
                              <input
                                type="hidden"
                                name="intent"
                                value="unshortlist"
                              />
                              <input
                                type="hidden"
                                name="teamId"
                                value={team.id}
                              />
                              <Button
                                type="submit"
                                size="sm"
                                variant="outline"
                                className="w-full border-orange-300 text-orange-700 hover:bg-orange-50"
                                disabled={isSubmitting || !nominationOpen}
                              >
                                <X className="mr-2 h-4 w-4" />
                                {nominationOpen
                                  ? "Unshortlist (Allow Edits)"
                                  : "Nomination Closed"}
                              </Button>
                            </Form>
                          )}
                          {(team.status === "submitted" ||
                            team.status === "selected" ||
                            team.status === "rejected") && (
                            <div className="rounded bg-muted p-2 text-center text-xs text-muted-foreground">
                              <Lock className="mr-1 inline h-3 w-3" />
                              Team has already submitted their idea &mdash; no
                              changes allowed.
                            </div>
                          )}
                          {team.status === "registered" && (
                            <div className="rounded bg-muted p-2 text-center text-xs text-muted-foreground">
                              Team has registered but not yet submitted the
                              questionnaire.
                            </div>
                          )}
                          {team.status === "invited" && (
                            <div className="rounded bg-muted p-2 text-center text-xs text-muted-foreground">
                              Awaiting team registration.
                            </div>
                          )}
                        </div>
                        <div className="mt-2 pt-2 border-t">
                          <Link
                            to={`/institution/teams/${team.id}`}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            View full details →
                          </Link>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty state */}
      {teams.length === 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-5 w-5" />
              No Teams Yet
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
              <Lightbulb className="mb-3 h-12 w-12 opacity-30" />
              <p className="mb-1 font-medium">No teams registered yet</p>
              <p className="text-sm">
                Use the invite form above to invite team leads.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-64" />
        <Skeleton className="h-4 w-32" />
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-24" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-12" />
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Invite form */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-48" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
            <Skeleton className="h-10 w-full rounded-lg" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-28" />
          </CardHeader>
          <CardContent className="space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Team list */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
