import {
	Building2,
	Check,
	CheckCircle,
	ChevronDown,
	ChevronUp,
	ClipboardList,
	Lightbulb,
	Loader2,
	Lock,
	Send,
	UserPlus,
	Users,
	X,
} from "lucide-react";
import { useContext, useState } from "react";
import {
	Form,
	Link,
	isRouteErrorResponse,
	useActionData,
	useLoaderData,
	useNavigation,
	useRouteError,
} from "react-router";
import { MetricCard } from "~/components/shared/metric-card";
import { PanelHeader } from "~/components/shared/panel-header";
import { StatusBadge } from "~/components/shared/status-badge";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Skeleton } from "~/components/ui/skeleton";
import { useActionToast } from "~/hooks/use-action-toast";
import { fail, ok, secureAction } from "~/lib/action.server";
import { getConfig } from "~/lib/config.server";
import { getStr, isEmail } from "~/lib/form.server";
import { secureLoader } from "~/lib/loader.server";
import { shortlistSchema, unshortlistSchema } from "~/lib/schemas/institution";
import { getInstitutionForUser, transitionTeamStatus } from "~/lib/team.server";
import type { InstitutionRecord, MemberRecord, TeamStatus } from "~/lib/types";

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

export const loader = secureLoader({ roles: ["institution"] }, async ({ user, pb }) => {
	pb.autoCancellation(false);

	// Resolve this institution via the user's id (no full scan).
	const institution = await getInstitutionForUser(pb, user.id);
	if (!institution) {
		throw new Response("Institution not found for this user", { status: 404 });
	}

	// Load teams + config in parallel. Field-trim expand to keep payload small.
	const MAX_SAFE_LIST = 500;
	const [teamsResult, flags] = await Promise.all([
		pb.collection("teams").getList<TeamWithExpand>(1, MAX_SAFE_LIST, {
			filter: pb.filter("institutionId = {:institutionId}", {
				institutionId: institution.id,
			}),
			expand: "leaderUserId",
			fields:
				"id,name,teamCode,status,idea_title,leaderUserId,institutionId,status_changed_at,questionnaire_completed,created,updated,expand.leaderUserId.name,expand.leaderUserId.email",
			sort: "-created",
		}),
		getConfig(pb),
	]);
	const teams = teamsResult.items;
	if (teamsResult.totalItems > MAX_SAFE_LIST) {
		console.warn(`[teams] More than ${MAX_SAFE_LIST} items — pagination needed`);
	}

	// Members: single query via institution relation traversal (avoids
	// building an OR chain of up to 500 team IDs).
	const allMembers =
		teams.length > 0
			? (
					await pb.collection("members").getList<MemberRecord>(1, MAX_SAFE_LIST, {
						filter: pb.filter("teamId.institutionId = {:instId}", { instId: institution.id }),
					})
				).items
			: [];

	const membersByTeam: Record<string, MemberRecord[]> = {};
	for (const m of allMembers) {
		if (!membersByTeam[m.teamId]) {
			membersByTeam[m.teamId] = [];
		}
		membersByTeam[m.teamId].push(m);
	}

	return {
		user,
		institution,
		teams,
		membersByTeam,
		nominationOpen: flags.nomination_open ?? false,
	};
});

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = secureAction(
	{ roles: ["institution"] },
	async ({ formData, user, pb, intent }) => {
		const institution = await getInstitutionForUser(pb, user.id);
		if (!institution) return fail({ error: "Institution not found", status: 404 });

		switch (intent) {
			case "invite-lead": {
				const name = getStr(formData, "name");
				const email = getStr(formData, "email", { lower: true });

				if (!name || !email) {
					return fail({ error: "Name and email are required" });
				}
				if (!isEmail(email)) {
					return fail({ error: "Enter a valid email address" });
				}

				// Capacity check + existing-user lookup are independent — parallel.
				const [teamCount, existingUser] = await Promise.all([
					pb.collection("teams").getList(1, 1, {
						filter: pb.filter("institutionId = {:instId}", {
							instId: institution.id,
						}),
						fields: "id",
					}),
					pb
						.collection("users")
						.getFirstListItem<{ id: string; role: string }>(
							pb.filter("email = {:email}", { email }),
							{ fields: "id,role" },
						)
						.catch(() => null),
				]);

				if (institution.maxTeams > 0 && teamCount.totalItems >= institution.maxTeams) {
					return fail({
						error: `This institution has reached its maximum of ${institution.maxTeams} teams.`,
					});
				}

				let leadUserId: string;

				if (existingUser) {
					// Don't allow an admin or coordinator to be re-registered as a lead.
					if (existingUser.role !== "lead") {
						return fail({ error: "This email is associated with a non-lead account" });
					}
					leadUserId = existingUser.id;
				} else {
					// Create user with a random password, then trigger PB's
					// password-reset email. The lead sets their own password.
					const tempPassword = crypto.randomUUID();
					const newUser = await pb.collection("users").create({
						email,
						password: tempPassword,
						passwordConfirm: tempPassword,
						name,
						role: "lead",
						institutionId: institution.id,
					});
					leadUserId = newUser.id;

					// Trigger PB's password-reset email.
					try {
						await pb.collection("users").requestPasswordReset(email);
					} catch (err) {
						console.error("[institution] Failed to send invite/reset email:", err);
					}
				}

				// Check for an existing team under this lead at this institution.
				const existingTeam = await pb
					.collection("teams")
					.getFirstListItem(
						pb.filter("leaderUserId = {:leaderUserId} && institutionId = {:institutionId}", {
							leaderUserId: leadUserId,
							institutionId: institution.id,
						}),
						{ fields: "id" },
					)
					.catch(() => null);
				if (existingTeam) {
					return fail({
						error: "A team already exists for this lead at your institution",
						status: 409,
					});
				}

				// Create the team.
				await pb.collection("teams").create({
					name: `${name}'s Team`,
					institutionId: institution.id,
					leaderUserId: leadUserId,
					status: "invited",
					status_changed_at: new Date().toISOString(),
				});

				return ok();
			}
			case "shortlist":
			case "unshortlist": {
				const schema = intent === "shortlist" ? shortlistSchema : unshortlistSchema;
				const parsed = schema.safeParse({
					teamId: formData.get("teamId"),
				});

				if (!parsed.success) {
					return fail({
						fieldErrors: Object.fromEntries(
							Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [
								k,
								Array.isArray(v) ? v[0] : (v ?? "Invalid"),
							]),
						),
					});
				}

				const { teamId } = parsed.data;
				const flags = await getConfig(pb);
				if (!flags.nomination_open) {
					return fail({ error: "Shortlisting is currently closed", status: 403 });
				}
				const to: TeamStatus = intent === "shortlist" ? "shortlisted" : "registered";
				const result = await transitionTeamStatus(pb, {
					teamId,
					to,
					role: "institution",
					institutionId: institution.id,
					actorUserId: user.id,
				});
				if (!result.ok) return result.response;
				return ok();
			}

			default:
				return fail({ error: "Unknown intent", status: 400 });
		}
	},
);

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
	const { user, institution, teams, membersByTeam, nominationOpen } = useLoaderData() as {
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
	useActionToast(actionData, { success: "Action completed successfully!" });

	const shortlistedCount = teams.filter(
		(t) => t.status === "shortlisted" || t.status === "submitted" || t.status === "selected",
	).length;

	// Capacity check — invite button disables when this institution
	// has hit its maxTeams ceiling (server enforces the same).
	const atCapacity = institution.maxTeams > 0 && teams.length >= institution.maxTeams;

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
		<div className="space-y-10">
			{/* Hero strip */}
			<div className="relative overflow-hidden rounded-lg border border-border bg-card">
				<div className="vh-grid-bg absolute inset-0 opacity-30" aria-hidden="true" />
				<div
					className="absolute -top-32 -right-24 h-72 w-72 rounded-full opacity-50 vh-wash-tr"
					aria-hidden="true"
				/>
				<div className="relative flex flex-col gap-4 p-6 md:flex-row md:items-end md:justify-between md:p-8">
					<div className="space-y-2">
						<p className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
							VisionHack · 2026 · Institution
						</p>
						<h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
							{institution.name}
						</h1>
						<p className="text-sm text-muted-foreground">
							{institution.district ? `${institution.district} · ` : ""}
							{user.name}
						</p>
					</div>
					<div className="flex items-center gap-2 shrink-0">
						{nominationOpen ? (
							<span className="inline-flex items-center gap-1.5 rounded-md bg-success/10 px-3 py-1.5 text-sm font-medium text-success ring-1 ring-inset ring-success/30">
								<span className="h-2 w-2 rounded-full bg-success live-dot" />
								Nomination open
							</span>
						) : (
							<span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground ring-1 ring-inset ring-border">
								<Lock className="h-3.5 w-3.5" />
								Nomination closed
							</span>
						)}
					</div>
				</div>
			</div>

			{/* Metrics */}
			<div className="grid gap-4 sm:grid-cols-3 stagger-cards">
				<MetricCard
					label="Total teams"
					value={teams.length}
					icon={Users}
					context={`Capacity ${institution.maxTeams}`}
				/>
				<MetricCard
					label="Shortlisted"
					value={`${shortlistedCount} / ${institution.maxTeams}`}
					icon={CheckCircle}
					tone="primary"
					context="Moved to submission phase"
				/>
				<MetricCard
					label="Members"
					value={Object.values(membersByTeam).reduce((s, m) => s + m.length, 0)}
					icon={Building2}
					context="Across all teams"
				/>
			</div>

			<div className="grid gap-6 lg:grid-cols-2">
				{/* Invite Team Lead Card */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<UserPlus className="h-5 w-5" />
							Invite team lead
						</CardTitle>
						<CardDescription>
							Add a team lead by name and email — they receive a sign-in link.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<div className="space-y-1.5">
							<Label htmlFor="invite-name" className="text-xs font-medium">
								Full name
							</Label>
							<Input
								id="invite-name"
								value={inviteName}
								onChange={(e) => setInviteName(e.target.value)}
								placeholder="e.g. Priya Menon"
							/>
						</div>
						<div className="space-y-1.5">
							<Label htmlFor="invite-email" className="text-xs font-medium">
								Email
							</Label>
							<Input
								id="invite-email"
								type="email"
								value={inviteEmail}
								onChange={(e) => setInviteEmail(e.target.value)}
								placeholder="lead@example.com"
								disabled={atCapacity}
							/>
						</div>
						{atCapacity && (
							<output className="block rounded-md border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning leading-relaxed">
								This institution has reached its maximum of {institution.maxTeams} teams. Contact
								the event admin to increase capacity.
							</output>
						)}
						<Form method="post">
							<input type="hidden" name="intent" value="invite-lead" />
							<input type="hidden" name="name" value={inviteName} />
							<input type="hidden" name="email" value={inviteEmail} />
							<Button
								type="submit"
								size="lg"
								className="w-full"
								disabled={isSubmitting || !inviteName.trim() || !inviteEmail.trim() || atCapacity}
							>
								{isSubmitting ? (
									<Loader2 className="mr-2 h-4 w-4 vh-spin" />
								) : (
									<Send className="mr-2 h-4 w-4" />
								)}
								{isSubmitting ? "Inviting" : "Send invite"}
							</Button>
						</Form>
					</CardContent>
				</Card>

				{/* How It Works */}
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<ClipboardList className="h-5 w-5" />
							How it works
						</CardTitle>
					</CardHeader>
					<CardContent className="space-y-4">
						<ol className="space-y-3 text-sm">
							{[
								{
									step: "01",
									title: "Add team lead",
									desc: "Enter the name and email of each team lead.",
								},
								{
									step: "02",
									title: "Account created",
									desc: "System creates an account with a generated password.",
								},
								{
									step: "03",
									title: "Email sent",
									desc: "Lead receives sign-in instructions.",
								},
								{
									step: "04",
									title: "Lead registers",
									desc: "They register their team and submit their idea.",
								},
							].map((s) => (
								<li key={s.step} className="flex gap-3">
									<span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-primary/12 font-mono text-[10px] font-semibold text-primary">
										{s.step}
									</span>
									<div>
										<p className="font-medium">{s.title}</p>
										<p className="text-xs text-muted-foreground leading-relaxed">{s.desc}</p>
									</div>
								</li>
							))}
						</ol>

						<div className="rounded-md border border-info/30 bg-info/8 px-3 py-2.5 text-xs text-info leading-relaxed">
							Invite as many teams as you want, but you can only shortlist up to{" "}
							{institution.maxTeams} teams for final submission.
						</div>
					</CardContent>
				</Card>
			</div>

			{/* Teams List */}
			{teams.length > 0 && (
				<div>
					<PanelHeader
						eyebrow="Campus"
						title={`Teams (${teams.length})`}
						description="All teams registered under your institution. Click a row to expand."
					/>
					<div className="space-y-3">
						{teams.map((team) => {
							const isExpanded = expandedTeams.has(team.id);

							return (
								<div key={team.id} className="rounded-lg border bg-card card-hover">
									<button
										type="button"
										className="flex w-full cursor-pointer items-start justify-between p-4 text-left"
										onClick={() => toggleTeamExpansion(team.id)}
										onKeyDown={(e) => {
											if (e.key === "Enter" || e.key === " ") {
												e.preventDefault();
												toggleTeamExpansion(team.id);
											}
										}}
										aria-expanded={isExpanded}
									>
										<div className="flex-1 space-y-2">
											<div className="flex items-center gap-2">
												<StatusBadge status={team.status} />
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
													<span className="font-medium text-foreground">Team:</span>{" "}
													<span className="text-muted-foreground">{team.name}</span>
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
									</button>

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
																<span className="font-medium text-foreground">{m.fullName}</span>
																<span className="text-muted-foreground">{m.email}</span>
																{m.role && (
																	<span className="ml-auto text-muted-foreground">{m.role}</span>
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
														<input type="hidden" name="intent" value="shortlist" />
														<input type="hidden" name="teamId" value={team.id} />
														<Button
															type="submit"
															size="sm"
															className="w-full bg-success hover:bg-success/80 text-success-foreground"
															disabled={isSubmitting || !nominationOpen}
														>
															<Check className="mr-2 h-4 w-4" />
															{nominationOpen ? "Shortlist Team" : "Nomination Closed"}
														</Button>
													</Form>
												)}
												{team.status === "shortlisted" && (
													<Form method="post">
														<input type="hidden" name="intent" value="unshortlist" />
														<input type="hidden" name="teamId" value={team.id} />
														<Button
															type="submit"
															size="sm"
															variant="outline"
															className="w-full border-orange-300 text-orange-700 hover:bg-orange-50"
															disabled={isSubmitting || !nominationOpen}
														>
															<X className="mr-2 h-4 w-4" />
															{nominationOpen ? "Unshortlist (Allow Edits)" : "Nomination Closed"}
														</Button>
													</Form>
												)}
												{(team.status === "submitted" ||
													team.status === "selected" ||
													team.status === "rejected") && (
													<div className="rounded bg-muted p-2 text-center text-xs text-muted-foreground">
														<Lock className="mr-1 inline h-3 w-3" />
														Team has already submitted their idea &mdash; no changes allowed.
													</div>
												)}
												{team.status === "registered" && (
													<div className="rounded bg-muted p-2 text-center text-xs text-muted-foreground">
														Team has registered but not yet submitted the questionnaire.
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
													to={`/teams/${team.id}`}
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
				</div>
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
							<p className="text-sm">Use the invite form above to invite team leads.</p>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}

export function ErrorBoundary() {
	const error = useRouteError();
	let message = "Something went wrong";

	if (isRouteErrorResponse(error)) {
		message =
			error.data && typeof error.data === "string"
				? error.data
				: `${error.status} ${error.statusText}`;
	} else if (error instanceof Error) {
		message = error.message;
	}

	return (
		<div className="flex min-h-[50vh] items-center justify-center p-8">
			<div className="mx-auto max-w-md text-center">
				<p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-danger">Error</p>
				<h1 className="mb-2 text-xl font-semibold tracking-tight">{message}</h1>
				<button
					type="button"
					onClick={() => window.location.reload()}
					className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
				>
					Try again
				</button>
			</div>
		</div>
	);
}
