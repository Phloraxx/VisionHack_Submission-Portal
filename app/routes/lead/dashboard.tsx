import { useLoaderData, Link, Form, useActionData } from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { validateOrigin } from "~/lib/csrf.server";
import { getConfig } from "~/lib/config.server";
import { STATUS_LABELS, STATUS_COLORS } from "~/lib/team-status";
import type { TeamStatus, TeamRecord } from "~/lib/types";
import { canTransition } from "~/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { Button } from "~/components/ui/button";
import {
  Users,
  UserPlus,
  FileText,
  Upload,
  Clock,
  CheckCircle2,
  ArrowRight,
  Lock,
  Circle,
  XCircle,
} from "lucide-react";
import { StepIndicator, getLeadSteps } from "~/components/shared/step-indicator";
import { PhaseTimeline } from "~/components/shared/phase-timeline";
import { ConfirmButton } from "~/components/shared/confirm-button";

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  const { pb, user } = await requireRole(request, ["lead"]);

  const teams = await pb
    .collection("teams")
    .getFullList<TeamRecord>({
      filter: pb.filter('leaderUserId = {:userId}', { userId: user.id }),
      expand: "institutionId",
    });

  const team = teams.length > 0 ? teams[0] : null;

  // Fetch institution name and campus lead contact
  let institutionName = "";
  let campusLeadName = "";
  let campusLeadEmail = "";
  if (team) {
    try {
      const inst = await pb.collection("institutions").getOne(team.institutionId);
      institutionName = (inst as any).name || "";
      if ((inst as any).campusLeadId) {
        const lead = await pb.collection("users").getOne((inst as any).campusLeadId);
        campusLeadName = (lead as any).name || "";
        campusLeadEmail = (lead as any).email || "";
      }
    } catch { /* ignore fetch errors */ }
  }

  // Check if the questionnaire has been submitted
  let questionnaireCompleted = false;
  if (team) {
    try {
      const responses = await pb
        .collection("questionnaire_responses")
        .getFullList({ filter: pb.filter('teamId = {:tid}', { tid: team.id }) });
      questionnaireCompleted = responses.length > 0;
    } catch {
      questionnaireCompleted = false;
    }
  }

  const config = await getConfig(pb);

  return {
    user,
    team,
    institutionName,
    campusLeadName,
    campusLeadEmail,
    questionnaireCompleted,
    registrationOpen: config.registration_open ?? false,
    questionnaireOpen: config.questionnaire_open ?? false,
    nominationOpen: config.nomination_open ?? false,
    submissionOpen: config.submission_open ?? false,
  };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  validateOrigin(request);
  const { pb, user } = await requireRole(request, ["lead"]);

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "withdraw") {
    const teams = await pb
      .collection("teams")
      .getFullList<TeamRecord>({
        filter: pb.filter('leaderUserId = {:userId}', { userId: user.id }),
      });

    if (teams.length === 0) {
      return Response.json({ error: "Team not found" }, { status: 404 });
    }

    const team = teams[0];

    if (!canTransition(team.status, "withdrawn", "lead")) {
      return Response.json(
        { error: "Cannot withdraw your team from its current status" },
        { status: 403 },
      );
    }

    await pb.collection("teams").update(team.id, {
      status: "withdrawn",
      status_changed_at: new Date().toISOString(),
    });

    return Response.json({ success: true });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export function meta() {
  return [{ title: "Team Dashboard — VisionHack" }];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** How many of the 3 steps are completed for this status?
 *  Questionnaire completion checks the actual response data,
 *  since questionnaire submission doesn't transition team status. */
function completedSteps(status: TeamStatus | null, questionnaireDone: boolean): number {
  if (!status || status === "invited") return 0;
  if (status === "registered") return questionnaireDone ? 2 : 1;
  if (status === "shortlisted") return 2;
  return 3; // submitted, selected, rejected — all done
}

/** Determine the per-card state: "done" | "active" | "locked" | "closed" */
type CardState = "done" | "active" | "locked" | "closed";

function cardState(
  step: "register" | "questionnaire" | "submit",
  status: TeamStatus | null,
  config: { registrationOpen: boolean; questionnaireOpen: boolean; submissionOpen: boolean },
  questionnaireDone: boolean,
): CardState {
  const stepNum = { register: 0, questionnaire: 1, submit: 2 }[step];
  const completed = completedSteps(status, questionnaireDone);

  if (stepNum < completed) return "done";
  if (stepNum === completed) {
    // Check if this step's feature flag is open
    const flag = { register: config.registrationOpen, questionnaire: config.questionnaireOpen, submit: config.submissionOpen }[step];
    return flag ? "active" : "closed";
  }
  return "locked";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeadDashboard() {
  const {
    user,
    team,
    institutionName,
    campusLeadName,
    campusLeadEmail,
    questionnaireCompleted,
    registrationOpen,
    questionnaireOpen,
    nominationOpen,
    submissionOpen,
  } = useLoaderData() as {
    user: { id: string; name: string; email: string };
    team: TeamRecord | null;
    institutionName: string;
    campusLeadName: string;
    campusLeadEmail: string;
    questionnaireCompleted: boolean;
    registrationOpen: boolean;
    questionnaireOpen: boolean;
    nominationOpen: boolean;
    submissionOpen: boolean;
  };
  const actionData = useActionData() as { success?: boolean; error?: string } | undefined;

  const status = team?.status ?? null;
  const colors = status ? STATUS_COLORS[status] : null;
  const config = { registrationOpen, questionnaireOpen, submissionOpen };
  const steps = getLeadSteps(status, "/lead/dashboard");
  const progress = completedSteps(status, questionnaireCompleted);
  const progressPct = (progress / 3) * 100;

  // Quick-action cards with completion state
  const cards: Array<{
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    description: string;
    state: CardState;
    stateLabel: string;
  }> = [
    {
      label: "Register Team",
      href: "/lead/register",
      icon: UserPlus,
      description: "Create your team and add up to 5 members",
      state: cardState("register", status, config, questionnaireCompleted),
      stateLabel: "Registration",
    },
    {
      label: "Questionnaire",
      href: "/lead/questionnaire",
      icon: FileText,
      description: "Complete your team profile questionnaire",
      state: cardState("questionnaire", status, config, questionnaireCompleted),
      stateLabel: "Questionnaire",
    },
    {
      label: "Submit Idea",
      href: "/lead/submit-idea",
      icon: Upload,
      description: "Upload your idea presentation (PDF/PPT)",
      state: cardState("submit", status, config, questionnaireCompleted),
      stateLabel: "Idea Submission",
    },
  ];

  const stateIcon = {
    done: CheckCircle2,
    active: ArrowRight,
    locked: Lock,
    closed: Lock,
  };

  const stateClass = {
    done: "border-emerald-200 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-950/30",
    active: "border-primary/20 bg-primary/5 dark:border-primary/30 dark:bg-primary/10",
    locked: "border-muted bg-muted/20",
    closed: "border-orange-200 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/30",
  };

  const stateColor = {
    done: "text-emerald-700 dark:text-emerald-400",
    active: "text-primary",
    locked: "text-muted-foreground",
    closed: "text-orange-700 dark:text-orange-400",
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Team Dashboard
        </h1>
        <p className="text-muted-foreground">
          Welcome back, {user.name}
        </p>
      </div>

      {/* Step Progress Indicator */}
      <StepIndicator steps={steps} />

      {/* Phase Timeline */}
      <PhaseTimeline
        phases={[
          { label: "Registration", open: registrationOpen },
          { label: "Questionnaire", open: questionnaireOpen },
          { label: "Shortlisting", open: nominationOpen },
          { label: "Submission", open: submissionOpen },
        ]}
      />

      {/* Status Card + Progress */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Team Status
          </CardTitle>
          <CardDescription>
            Your current progress in VisionHack 2026
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Progress bar */}
          <div>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                Overall progress
              </span>
              <span className="font-medium tabular-nums">{progress} / 3 steps</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <span className="text-sm text-muted-foreground">Status</span>
            {status ? (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${colors?.bg} ${colors?.text}`}
              >
                <span className={`h-2 w-2 rounded-full ${colors?.dot}`} />
                {STATUS_LABELS[status]}
              </span>
            ) : (
              <span className="text-sm text-muted-foreground">
                Not Started
              </span>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Team Name</span>
            <span className="text-sm font-medium">
              {team?.name || "Not Set"}
            </span>
          </div>
          {team?.teamCode && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                Team Code
              </span>
              <span className="font-mono text-sm font-medium">
                {team.teamCode}
              </span>
            </div>
          )}
          {institutionName && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Institution</span>
              <span className="text-sm font-medium">{institutionName}</span>
            </div>
          )}
          {campusLeadName && (
            <div className="flex items-center justify-between pt-1">
              <span className="text-sm text-muted-foreground">Campus Lead</span>
              <span className="text-sm font-medium">
                {campusLeadName}
                {campusLeadEmail && (
                  <span className="block text-xs text-muted-foreground text-right">
                    {campusLeadEmail}
                  </span>
                )}
              </span>
            </div>
          )}

          {team && (
            <div className="flex items-center justify-between pt-1">
              <Link
                to="/lead/team"
                className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
              >
                View team details
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
          )}

          {/* Callout per status */}
          {status === "invited" && (
            <div className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
              You've been invited! Complete your team registration to get started.
            </div>
          )}
          {status === "submitted" && (
            <div className="rounded-lg bg-purple-50 p-3 text-sm text-purple-800 dark:bg-purple-950 dark:text-purple-200">
              Your idea has been submitted and is under review. Awaiting results.
            </div>
          )}
          {status === "selected" && (
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              Congratulations! Your team has been selected. Check your email for further instructions.
            </div>
          )}
          {status === "rejected" && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
              Your application was not selected for the next round. Thank you for participating.
            </div>
          )}

          {/* Withdraw action */}
          {status && !["withdrawn", "selected", "rejected"].includes(status) && (
            <div className="border-t pt-3">
              <Form method="post">
                <input type="hidden" name="intent" value="withdraw" />
                <ConfirmButton
                  type="submit"
                  label="Withdraw Team"
                  confirmMessage="Are you sure you want to withdraw? This cannot be undone."
                  variant="destructive"
                  className="w-full justify-center"
                  icon={<XCircle className="mr-1.5 h-4 w-4" />}
                />
              </Form>
              <p className="mt-1 text-center text-xs text-muted-foreground">
                You will not be able to rejoin after withdrawing.
              </p>
            </div>
          )}

          {/* Action feedback */}
          {actionData?.success && (
            <div className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
              Your team has been withdrawn.
            </div>
          )}
          {actionData?.error && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
              {actionData.error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Action Cards */}
      <div className="grid gap-4 md:grid-cols-3 stagger-cards">
        {cards.map((card) => {
          const Icon = card.icon;
          const SI = stateIcon[card.state];
          return (
            <Card
              key={card.href}
              className={`relative border ${stateClass[card.state]} card-hover`}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Icon className="h-4 w-4" />
                  {card.label}
                </CardTitle>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  <SI className={`h-4 w-4 ${stateColor[card.state]}`} />
                  <span className={`text-xs font-medium ${stateColor[card.state]}`}>
                    {card.state === "done"
                      ? "Completed"
                      : card.state === "active"
                        ? "Available"
                        : card.state === "closed"
                          ? "Closed"
                          : "Locked"}
                  </span>
                </div>
                {card.state === "active" && (
                  <Link to={card.href}>
                    <Button className="mt-3 w-full" size="sm">
                      Continue
                      <ArrowRight className="ml-2 h-3 w-3" />
                    </Button>
                  </Link>
                )}
                {card.state === "done" && (
                  <Link to={card.href}>
                    <Button variant="outline" className="mt-3 w-full" size="sm">
                      View details
                    </Button>
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-48" />
      </div>

      {/* Step indicator */}
      <Skeleton className="h-16 w-full rounded-lg" />

      {/* Phase timeline */}
      <Skeleton className="h-12 w-full rounded-lg" />

      {/* Status card + progress */}
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-2 w-full rounded-full" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 w-24" />
        </CardContent>
      </Card>

      {/* Action cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i}>
            <CardHeader>
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-3 w-full" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-full rounded-lg" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
