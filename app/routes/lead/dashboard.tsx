import {
	ArrowRight,
	Building2,
	CheckCircle2,
	Clock,
	FileText,
	Lock,
	Sparkles,
	Upload,
	UserPlus,
	Users,
	XCircle,
} from "lucide-react";
import { Form, Link, useActionData, useLoaderData } from "react-router";
import { Callout } from "~/components/shared/callout";
import { ConfirmButton } from "~/components/shared/confirm-button";
import { MetricCard } from "~/components/shared/metric-card";
import { PanelHeader } from "~/components/shared/panel-header";
import { PhaseStrip } from "~/components/shared/phase-strip";
import { ProgressBar } from "~/components/shared/progress-bar";
import { Row } from "~/components/shared/row";
import { StepIndicator, getLeadSteps } from "~/components/shared/step-indicator";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { fail, ok, secureAction } from "~/lib/action.server";
import { getConfig } from "~/lib/config.server";
import { secureLoader } from "~/lib/loader.server";
import { STATUS_COLORS, STATUS_LABELS } from "~/lib/team-status";
import { getLeadTeam, transitionTeamStatus } from "~/lib/team.server";
import type { TeamStatus, TeamView } from "~/lib/types";

// ---------------------------------------------------------------------------
// Loader / Action
// ---------------------------------------------------------------------------

export const loader = secureLoader({ roles: ["lead"] }, async ({ user, pb }) => {
	// Team + config are independent — fetch in parallel.
	const [team, config] = await Promise.all([
		getLeadTeam<TeamView>(pb, user.id, {
			expand: "institutionId",
			fields:
				"id,name,status,institutionId,leaderUserId,teamCode,idea_title,questionnaire_completed,status_changed_at,created,updated,expand.institutionId.name,expand.institutionId.district",
		}),
		getConfig(pb),
	]);

	let institutionName = "";
	let campusLeadName = "";
	let campusLeadEmail = "";
	let memberCount = 0;

	if (team) {
		institutionName = team.expand?.institutionId?.name ?? "";

		// Member count + institution record run in parallel (both depend only
		// on the already-fetched team).
		const [memberCountResult, inst] = await Promise.all([
			pb.collection("members").getList(1, 1, {
				filter: pb.filter("teamId = {:tid}", { tid: team.id }),
				fields: "id",
			}),
			team.institutionId
				? pb
						.collection("institutions")
						.getOne<{ campusLeadId?: string }>(team.institutionId, {
							fields: "id,campusLeadId",
						})
						.catch(() => null)
				: Promise.resolve(null),
		]);

		memberCount = memberCountResult.totalItems;

		// Campus lead is the only genuinely dependent hop (needs inst first).
		if (inst?.campusLeadId) {
			const lead = await pb
				.collection("users")
				.getOne<{ name?: string; email?: string }>(inst.campusLeadId, {
					fields: "id,name,email",
				})
				.catch(() => null);
			if (lead) {
				campusLeadName = lead.name || "";
				campusLeadEmail = lead.email || "";
			}
		}
	}

	// Denormalized: the questionnaire action sets `questionnaire_completed`
	// on the team, so we don't need a join here. Falls back to false
	// for legacy teams that predate the field.
	const questionnaireCompleted = team?.questionnaire_completed ?? false;

	return {
		user,
		team,
		institutionName,
		campusLeadName,
		campusLeadEmail,
		memberCount,
		questionnaireCompleted,
		registrationOpen: config.registration_open ?? false,
		questionnaireOpen: config.questionnaire_open ?? false,
		nominationOpen: config.nomination_open ?? false,
		submissionOpen: config.submission_open ?? false,
	};
});

export const action = secureAction({ roles: ["lead"] }, async ({ user, pb, intent }) => {
	if (intent === "withdraw") {
		const team = await getLeadTeam(pb, user.id, { fields: "id,status" });
		if (!team) return fail({ error: "Team not found", status: 404 });

		const result = await transitionTeamStatus(pb, {
			teamId: team.id,
			to: "withdrawn",
			role: "lead",
			actorUserId: user.id,
		});
		if (!result.ok) return result.response;
		return ok();
	}

	return fail({ error: "Unknown intent", status: 400 });
});

export function meta() {
	return [{ title: "Team Dashboard — VisionHack" }];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function completedSteps(status: TeamStatus | null, questionnaireDone: boolean): number {
	if (!status || status === "invited") return 0;
	if (status === "registered") return questionnaireDone ? 2 : 1;
	if (status === "shortlisted") return 2;
	// Withdrawn teams max out at step 2 (can't submit ideas).
	if (status === "withdrawn") return 2;
	// submitted/selected show all 3 steps as completed.
	return 3;
}

type CardState = "done" | "active" | "locked" | "closed";

function cardState(
	step: "register" | "questionnaire" | "submit",
	status: TeamStatus | null,
	flags: { registrationOpen: boolean; questionnaireOpen: boolean; submissionOpen: boolean },
	questionnaireDone: boolean,
): CardState {
	const stepNum = { register: 0, questionnaire: 1, submit: 2 }[step];
	const completed = completedSteps(status, questionnaireDone);

	if (stepNum < completed) return "done";
	if (stepNum === completed) {
		const flag = {
			register: flags.registrationOpen,
			questionnaire: flags.questionnaireOpen,
			submit: flags.submissionOpen,
		}[step];
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
		memberCount,
		questionnaireCompleted,
		registrationOpen,
		questionnaireOpen,
		nominationOpen,
		submissionOpen,
	} = useLoaderData() as {
		user: { id: string; name: string; email: string };
		team: TeamView | null;
		institutionName: string;
		campusLeadName: string;
		campusLeadEmail: string;
		memberCount: number;
		questionnaireCompleted: boolean;
		registrationOpen: boolean;
		questionnaireOpen: boolean;
		nominationOpen: boolean;
		submissionOpen: boolean;
	};
	const actionData = useActionData() as { success?: boolean; error?: string } | undefined;

	const status = team?.status ?? null;
	const colors = status ? STATUS_COLORS[status] : null;
	const flags = { registrationOpen, questionnaireOpen, submissionOpen };
	const steps = getLeadSteps(status, "/lead/dashboard");
	const progress = completedSteps(status, questionnaireCompleted);

	// One-line next action — the canonical "what to do now" for this lead.
	// Kept terse so it reads as instruction, not status report.
	const nextAction: string = (() => {
		if (!team) return "Start by registering your team and adding up to 5 members.";
		if (status === "invited")
			return "Register your team to unlock the questionnaire and submission.";
		if (status === "registered") {
			return questionnaireCompleted
				? "Awaiting shortlisting by your campus lead. We'll email you when there's an update."
				: "Complete the team profile questionnaire to unlock submission.";
		}
		if (status === "shortlisted")
			return "Upload your idea presentation (PDF or PPT) to enter final review.";
		if (status === "submitted")
			return "Your idea is under review. Decisions land by the end of the event.";
		if (status === "selected") return "Check your email for next steps and the finalist briefing.";
		if (status === "rejected")
			return "Thanks for submitting. Watch the VisionHack channel for upcoming editions.";
		if (status === "withdrawn")
			return "This team has been withdrawn. Contact your campus lead to re-register.";
		return "";
	})();

	const cards: Array<{
		label: string;
		href: string;
		icon: React.ComponentType<{ className?: string }>;
		description: string;
		state: CardState;
		stepNumber: string;
	}> = [
		{
			label: "Register team",
			href: "/lead/register",
			icon: UserPlus,
			description: "Create your team and add up to 5 members",
			state: cardState("register", status, flags, questionnaireCompleted),
			stepNumber: "01",
		},
		{
			label: "Questionnaire",
			href: "/lead/questionnaire",
			icon: FileText,
			description: "Complete your team's profile",
			state: cardState("questionnaire", status, flags, questionnaireCompleted),
			stepNumber: "02",
		},
		{
			label: "Submit idea",
			href: "/lead/submit-idea",
			icon: Upload,
			description: "Upload your idea presentation (PDF/PPT)",
			state: cardState("submit", status, flags, questionnaireCompleted),
			stepNumber: "03",
		},
	];

	return (
		<div className="space-y-10">
			{/* ------------------------------------------------------------
          HERO — current status, mission line
          ------------------------------------------------------------ */}
			<div className="relative overflow-hidden rounded-lg border border-border bg-card">
				<div className="vh-grid-bg absolute inset-0 opacity-30" aria-hidden="true" />
				<div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
					<div className="space-y-3 max-w-xl">
						<p className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
							VisionHack · 2026 · Team
						</p>
						<h1 className="text-2xl font-semibold tracking-tight md:text-3xl text-wrap-balance">
							{team ? `Hi, ${user.name.split(" ")[0]}` : "Welcome to VisionHack"}
						</h1>
						<p className="text-sm text-muted-foreground leading-relaxed text-wrap-pretty">
							{nextAction}
						</p>
					</div>
					{status && colors && (
						<div className="flex flex-row items-center justify-between gap-3 sm:flex-col sm:items-start md:items-end shrink-0">
							<span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground sm:order-2 md:order-1">
								Current status
							</span>
							<span
								className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium sm:order-1 md:order-2 ${colors.pill}`}
							>
								<span className={`h-2 w-2 rounded-full ${colors.dot}`} />
								{STATUS_LABELS[status]}
							</span>
						</div>
					)}
				</div>
			</div>

			{/* ------------------------------------------------------------
          STEP INDICATOR — single primary stepper
          ------------------------------------------------------------ */}
			<StepIndicator steps={steps} />

			{/* ------------------------------------------------------------
          METRICS — 3 compact stat cards (members, status, institution)
          ------------------------------------------------------------ */}
			<div className="grid gap-4 sm:grid-cols-3 stagger-cards">
				<MetricCard
					label="Team members"
					value={team ? memberCount : "—"}
					icon={Users}
					context={team ? "Including the team lead" : "Register to add members"}
				/>
				<MetricCard
					label="Steps completed"
					value={`${progress} / 3`}
					icon={CheckCircle2}
					tone="info"
					context={
						progress === 3
							? "All done — awaiting decisions"
							: progress === 0
								? "Not started"
								: "Keep going"
					}
				/>
				<MetricCard
					label="Institution"
					value={institutionName || "—"}
					icon={Building2}
					context={campusLeadName || "No campus lead assigned"}
				/>
			</div>

			{/* ------------------------------------------------------------
          PROGRESS BAR — fine-grained progress
          ------------------------------------------------------------ */}
			<Card>
				<CardContent className="p-6">
					<div className="flex items-baseline justify-between gap-4 mb-4">
						<div>
							<p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
								Progress
							</p>
							<h3 className="mt-0.5 text-base font-semibold tracking-tight text-wrap-balance">
								Where you are in the workflow
							</h3>
						</div>
						<span className="font-mono text-xs tabular-nums text-muted-foreground">
							{progress} / 3
						</span>
					</div>
					<ProgressBar
						value={progress}
						max={3}
						tone={status === "selected" ? "success" : status === "rejected" ? "danger" : "primary"}
					/>
					<span className="sr-only" aria-live="polite">
						{progress} of 3 steps completed
					</span>
				</CardContent>
			</Card>

			{/* ------------------------------------------------------------
          ACTION CARDS — 3 cards, collapsed card-state palette
          ------------------------------------------------------------ */}
			<div>
				<PanelHeader
					eyebrow="Workflow"
					title="Your next moves"
					description={
						status
							? "Each card represents a step in the submission workflow."
							: "Start with step 1 to create your team."
					}
				/>
				<div className="grid gap-4 md:grid-cols-3 stagger-cards">
					{cards.map((card) => {
						const Icon = card.icon;
						const stateClasses: Record<CardState, string> = {
							done: "border-success/30 bg-success/5",
							active: "border-primary/40 bg-primary/5",
							locked: "border-border bg-card opacity-60",
							closed: "border-border bg-muted/30",
						};
						const stateLabel: Record<CardState, string> = {
							done: "Completed",
							active: "Available",
							locked: "Locked",
							closed: "Closed",
						};
						const stateTone: Record<CardState, string> = {
							done: "text-success",
							active: "text-primary",
							locked: "text-muted-foreground",
							closed: "text-muted-foreground",
						};
						const stateIcon: Record<CardState, React.ReactNode> = {
							done: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
							active: <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />,
							locked: <Lock className="h-3.5 w-3.5" aria-hidden="true" />,
							closed: <Clock className="h-3.5 w-3.5" aria-hidden="true" />,
						};

						return (
							<Card
								key={card.href}
								variant="elevated"
								className={`relative ${stateClasses[card.state]}`}
							>
								<CardContent className="flex h-full flex-col justify-between p-5">
									<div className="flex items-start justify-between gap-3">
										<div className="space-y-2 min-w-0">
											<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
												Step {card.stepNumber}
											</span>
											<h3 className="text-base font-semibold tracking-tight flex items-center gap-2 text-wrap-balance">
												<Icon className="h-4 w-4" />
												{card.label}
											</h3>
											<p className="text-sm text-muted-foreground leading-relaxed">
												{card.description}
											</p>
										</div>
									</div>
									<div className="mt-5 flex items-center justify-between gap-2">
										<span
											className={`inline-flex items-center gap-1.5 text-xs font-medium ${stateTone[card.state]}`}
										>
											{stateIcon[card.state]}
											{stateLabel[card.state]}
										</span>
										{(card.state === "active" || card.state === "done") && (
											<Link to={card.href}>
												<Button
													size="sm"
													variant={card.state === "done" ? "outline" : "default"}
													className="h-8"
												>
													{card.state === "done" ? "View" : "Continue"}
													<ArrowRight className="ml-1.5 h-3 w-3" />
												</Button>
											</Link>
										)}
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			</div>

			{/* ------------------------------------------------------------
          PHASE STRIP — compact, secondary surface
          ------------------------------------------------------------ */}
			<div>
				<PanelHeader
					eyebrow="Event"
					title="Phases"
					description="The four phases of the event and their current state."
				/>
				<PhaseStrip
					phases={[
						{ label: "Registration", open: registrationOpen, detail: "Team signup" },
						{ label: "Questionnaire", open: questionnaireOpen, detail: "Profile" },
						{ label: "Shortlisting", open: nominationOpen, detail: "Review" },
						{ label: "Submission", open: submissionOpen, detail: "Ideas" },
					]}
				/>
			</div>

			{/* ------------------------------------------------------------
          TEAM CARD + WITHDRAW — secondary
          ------------------------------------------------------------ */}
			{team && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base flex items-center gap-2 text-wrap-balance">
							<Sparkles className="h-4 w-4 text-primary" />
							Team details
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-3">
						<div className="grid gap-3 sm:grid-cols-2">
							<Row label="Team name">{team.name}</Row>
							{team.teamCode && <Row label="Team code">{team.teamCode}</Row>}
							{institutionName && <Row label="Institution">{institutionName}</Row>}
							{campusLeadName && (
								<Row label="Campus lead">
									<span>
										{campusLeadName}
										{campusLeadEmail && (
											<span className="block text-xs text-muted-foreground">{campusLeadEmail}</span>
										)}
									</span>
								</Row>
							)}
						</div>

						{/* Status-specific callout */}
						{status === "invited" && (
							<Callout tone="info">
								You've been invited. Complete your team registration to get started.
							</Callout>
						)}
						{status === "submitted" && (
							<Callout tone="info">
								Your idea is submitted and under review. Awaiting results.
							</Callout>
						)}
						{status === "selected" && (
							<Callout tone="success">
								Congratulations — your team has been selected. Check your email for next steps.
							</Callout>
						)}
						{status === "rejected" && (
							<Callout tone="danger">
								Your application was not selected this round. Thank you for participating.
							</Callout>
						)}

						{status && !["withdrawn", "selected", "rejected"].includes(status) && (
							<div className="border-t border-border pt-4">
								<Form method="post">
									<input type="hidden" name="intent" value="withdraw" />
									<ConfirmButton
										label="Withdraw team"
										confirmMessage="Withdraw your team? This cannot be undone."
										variant="destructive"
										className="w-full justify-center"
										icon={<XCircle className="mr-1.5 h-4 w-4" />}
									/>
								</Form>
								<p className="mt-1.5 text-center text-xs text-muted-foreground">
									You will not be able to rejoin after withdrawing.
								</p>
							</div>
						)}

						{actionData?.success && <Callout tone="success">Your team has been withdrawn.</Callout>}
						{actionData?.error && <Callout tone="danger">{actionData.error}</Callout>}
					</CardContent>
				</Card>
			)}
		</div>
	);
}
