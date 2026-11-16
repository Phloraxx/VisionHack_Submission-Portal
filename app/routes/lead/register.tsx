import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, Loader2, Save, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
	Form,
	isRouteErrorResponse,
	useActionData,
	useLoaderData,
	useNavigation,
	useRouteError,
} from "react-router";
import { PanelHeader } from "~/components/shared/panel-header";
import { ReviewSummary } from "~/components/shared/review-summary";
import {
	StepIndicator,
	getStatusStepStates,
	resolveActiveStep,
} from "~/components/shared/step-indicator";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { useActionToast } from "~/hooks/use-action-toast";
import { useAutoSave } from "~/hooks/use-auto-save";
import { type ActionResult, fail, ok, secureAction } from "~/lib/action.server";
import { getConfig } from "~/lib/config.server";
import {
	type MemberCreateInput,
	institutions,
	members,
	statusTransitions,
	teams,
	withTransaction,
} from "~/lib/db.server";
import { getAllStr, getStr } from "~/lib/form.server";
import { secureLoader } from "~/lib/loader.server";
import { registerSchema } from "~/lib/schemas/register";
import { getLeadTeam } from "~/lib/team.server";
import { canTransition } from "~/lib/transitions";
import type { MemberRecord, TeamRecord, UserRecord } from "~/lib/types";
import { extractFieldErrors } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RegisterFormData {
	teamName: string;
	leadPhone: string;
	leadGender: string;
	leadRole: string;
	members: Array<{
		fullName: string;
		email: string;
		phone: string;
		gender: string;
		role: string;
	}>;
}

interface LoaderData {
	user: { id: string; name: string; email: string; institutionId: string };
	team: TeamRecord | null;
	members: MemberRecord[];
	registrationOpen: boolean;
}

interface ActionData {
	success?: boolean;
	error?: string;
	fieldErrors?: Record<string, string>;
}

/** Upper bound for the member reads — a team has at most six rows. */
const MAX_SAFE_LIST = 500;

/** `teams.name` is varchar(100); the form allows more. */
const TEAM_NAME_MAX = 100;

/**
 * Abort the registration transaction with a ready-made action result.
 *
 * Thrown from inside `withTransaction` so every write rolls back, then caught
 * by the action and returned to the client unchanged.
 */
class RegistrationError extends Error {
	constructor(readonly response: ActionResult) {
		super("registration aborted");
	}
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = secureLoader({ roles: ["lead"] }, async ({ user }) => {
	// Team and config are independent — fetch in parallel.
	const [team, flags] = await Promise.all([getLeadTeam<TeamRecord>(user.id), getConfig()]);

	const memberRows: MemberRecord[] = team
		? (await members.list(user, { teamId: team.id, perPage: MAX_SAFE_LIST })).items
		: [];

	return {
		user,
		team,
		members: memberRows,
		registrationOpen: flags.registration_open ?? false,
	} satisfies LoaderData;
});

// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------

interface ResolvedTeam {
	id: string;
	/** True when the team already existed, so its roster must be replaced. */
	existing: boolean;
}

/**
 * Find the lead's team or create it.
 *
 * Throws `RegistrationError` carrying the response the route has always
 * returned when the lead may not register: a status they cannot re-register
 * from, a lost optimistic lock, a missing institution, or a full institution
 * (SEC-9).
 */
async function resolveTeam(user: UserRecord, teamName: string): Promise<ResolvedTeam> {
	const existingTeam = await teams.findByLeader(user, user.id);

	if (existingTeam) {
		if (!canTransition(existingTeam.status, "registered", "lead")) {
			throw new RegistrationError(
				fail({
					error: `Cannot re-register team in "${existingTeam.status}" status. Contact your institution lead.`,
				}),
			);
		}

		// Optimistic lock on the status we just checked — rejects a
		// concurrent transition (e.g. institution shortlisting the team)
		// rather than silently overwriting it back to "registered".
		const updated = await teams.update(
			user,
			existingTeam.id,
			{
				name: teamName.slice(0, TEAM_NAME_MAX),
				status: "registered",
				statusChangedAt: new Date().toISOString(),
			},
			{ expectedStatus: existingTeam.status },
		);
		if (!updated) {
			throw new RegistrationError(
				fail({
					error: "This team's status was changed by another action. Please refresh and try again.",
					status: 409,
				}),
			);
		}
		return { id: updated.id, existing: true };
	}

	// A lead without an institution cannot register — the team requires an
	// institutionId, and the capacity check below needs it too.
	if (!user.institutionId) {
		throw new RegistrationError(
			fail({
				error:
					"You have not been assigned to an institution. Contact your campus lead or event admin.",
				status: 403,
			}),
		);
	}

	// SEC-9: capacity check — the institution's maxTeams against its current
	// team count.
	const institution = await institutions.getOne(user, user.institutionId);
	if (!institution) throw new Error("Institution not found");
	const currentTeamCount = await teams.countByInstitution(user, user.institutionId);
	if (institution.maxTeams > 0 && currentTeamCount >= institution.maxTeams) {
		throw new RegistrationError(
			fail({
				error: "Your institution has reached the maximum number of teams allowed",
				status: 403,
			}),
		);
	}

	const newTeam = await teams.create(user, {
		name: teamName.slice(0, TEAM_NAME_MAX),
		institutionId: user.institutionId,
		leaderUserId: user.id,
		status: "registered",
		statusChangedAt: new Date().toISOString(),
	});
	if (!newTeam) throw new Error("Team could not be created");

	// Audit row for self-registration — same transaction as the team, so the
	// two can never disagree.
	await statusTransitions.create(user, {
		teamId: newTeam.id,
		fromStatus: "",
		toStatus: "registered",
		at: new Date().toISOString(),
	});

	return { id: newTeam.id, existing: false };
}

interface RosterInput {
	leadPhone: string;
	leadGender: string;
	leadRole: string;
	names: string[];
	emails: string[];
	phones: string[];
	genders: string[];
	roles: string[];
}

/**
 * Write the submitted roster for `team`.
 *
 * The lead is always written first; any member row whose email matches the
 * lead's is dropped so the lead is never duplicated. A re-registration drops
 * the previous rows first — `members` is unique on `(team_id, email)`, so
 * creating before deleting would collide with the roster being replaced.
 * Both steps share the registration transaction, so the roster is never
 * observed half-written.
 */
async function replaceRoster(
	user: UserRecord,
	team: ResolvedTeam,
	roster: RosterInput,
): Promise<void> {
	if (team.existing) {
		const previous = await members.list(user, { teamId: team.id, perPage: MAX_SAFE_LIST });
		for (const member of previous.items) {
			await members.delete(user, member.id);
		}
	}

	const leadEmailLower = user.email.toLowerCase();
	const payloads: MemberCreateInput[] = [
		{
			teamId: team.id,
			fullName: user.name,
			email: user.email,
			phone: roster.leadPhone,
			gender: roster.leadGender,
			role: roster.leadRole,
		},
		...roster.names
			.map((rawName, i) => ({
				teamId: team.id,
				fullName: rawName.trim().slice(0, 100),
				email: (roster.emails[i] ?? "").trim().toLowerCase().slice(0, 200),
				phone: (roster.phones[i] ?? "").trim().slice(0, 20),
				gender: roster.genders[i] ?? "",
				role: (roster.roles[i] ?? "").trim().slice(0, 100),
			}))
			.filter((m) => m.email !== leadEmailLower),
	];

	for (const payload of payloads) {
		// A rejected row — a duplicate email in the roster, or a scope failure
		// — aborts the registration with the member-specific 500 the route has
		// always returned.
		const created = await members.create(user, payload).catch(() => null);
		if (!created) {
			throw new RegistrationError(
				fail({ error: "Failed to save team members. Please try again.", status: 500 }),
			);
		}
	}
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = secureAction({ roles: ["lead"] }, async ({ formData, user }) => {
	const flags = await getConfig();
	if (!flags.registration_open) {
		return fail({ error: "Registration is currently closed", status: 403 });
	}

	const parsed = registerSchema.safeParse({
		teamName: getStr(formData, "teamName"),
		leadPhone: getStr(formData, "leadPhone"),
		leadGender: getStr(formData, "leadGender", { trim: false }),
		leadRole: getStr(formData, "leadRole"),
		memberName: getAllStr(formData, "memberName"),
		memberEmail: getAllStr(formData, "memberEmail"),
		memberPhone: getAllStr(formData, "memberPhone"),
		memberGender: getAllStr(formData, "memberGender"),
		memberRole: getAllStr(formData, "memberRole"),
	});

	if (!parsed.success) {
		return fail({
			fieldErrors: extractFieldErrors(parsed.error),
		});
	}

	const {
		teamName,
		leadPhone,
		leadGender,
		leadRole,
		memberName: memberNames,
		memberEmail: memberEmails,
		memberPhone: memberPhones,
		memberGender: memberGenders,
		memberRole: memberRoles,
	} = parsed.data;

	// The team row, its roster and the audit row are one unit: a failure
	// anywhere rolls the whole registration back (plan §6.1).
	try {
		await withTransaction(async () => {
			const team = await resolveTeam(user, teamName);
			await replaceRoster(user, team, {
				leadPhone,
				leadGender,
				leadRole,
				names: memberNames,
				emails: memberEmails,
				phones: memberPhones,
				genders: memberGenders,
				roles: memberRoles,
			});
		});
	} catch (err) {
		if (err instanceof RegistrationError) return err.response;
		throw err;
	}

	return ok();
});

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export function meta() {
	return [{ title: "Step 1 of 3: Register Team — VisionHack" }];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeadRegister() {
	const { user, team, members, registrationOpen } = useLoaderData() as LoaderData;
	const actionData = useActionData() as ActionData | undefined;
	const navigation = useNavigation();
	const isSubmitting = navigation.state === "submitting";

	// Autosave — periodically persist form state (sessionStorage + server
	// draft for cross-device resume), restore drafts on mount.
	const { savedData, save, clearSaved } = useAutoSave<RegisterFormData>(
		`register-form-${user.id}`,
		true, // clearOnUnmount — PII should not persist after closing
	);

	const leadMember = members.find((m) => m.email === user.email);
	// Filter out the lead from members list
	const otherMembers = members.filter((m) => m.email.toLowerCase() !== user.email.toLowerCase());

	const {
		register,
		control,
		formState: { errors },
		setValue,
		getValues,
		watch,
	} = useForm({
		resolver: zodResolver(registerSchema),
		defaultValues: {
			teamName: team?.name ?? savedData?.teamName ?? "",
			leadPhone: leadMember?.phone ?? savedData?.leadPhone ?? "",
			leadGender: leadMember?.gender ?? savedData?.leadGender ?? "",
			leadRole: leadMember?.role ?? savedData?.leadRole ?? "",
			memberName: otherMembers.length > 0 ? otherMembers.map((m) => m.fullName) : [""],
			memberEmail: otherMembers.length > 0 ? otherMembers.map((m) => m.email) : [""],
			memberPhone: otherMembers.length > 0 ? otherMembers.map((m) => m.phone) : [""],
			memberGender: otherMembers.length > 0 ? otherMembers.map((m) => m.gender) : [""],
			memberRole: otherMembers.length > 0 ? otherMembers.map((m) => m.role) : [""],
		},
	});

	const memberCount = watch("memberName")?.length ?? 0;

	const isApproved =
		team?.status === "shortlisted" || team?.status === "submitted" || team?.status === "selected";

	const steps = resolveActiveStep(getStatusStepStates(team?.status ?? null), "/lead/register");
	const [showReview, setShowReview] = useState(false);

	const watchedForm = watch();

	// Save on every field change
	useEffect(() => {
		save({
			teamName: watchedForm.teamName ?? "",
			leadPhone: watchedForm.leadPhone ?? "",
			leadGender: watchedForm.leadGender ?? "",
			leadRole: watchedForm.leadRole ?? "",
			members: ((watchedForm.memberName ?? []) as string[]).map((_, i) => ({
				fullName: (watchedForm.memberName ?? [])[i] ?? "",
				email: (watchedForm.memberEmail ?? [])[i] ?? "",
				phone: (watchedForm.memberPhone ?? [])[i] ?? "",
				gender: (watchedForm.memberGender ?? [])[i] ?? "",
				role: (watchedForm.memberRole ?? [])[i] ?? "",
			})),
		});
	}, [watchedForm, save]);

	// Clear autosave on successful submit.
	useEffect(() => {
		if (actionData?.success) clearSaved();
	}, [actionData?.success, clearSaved]);

	// Success / error toasts.
	useActionToast(actionData, {
		success: () => (team ? "Team updated!" : "Team registered!"),
	});

	const addMember = () => {
		if (memberCount >= 5) return;
		setValue("memberName", [...(getValues("memberName") ?? []), ""]);
		setValue("memberEmail", [...(getValues("memberEmail") ?? []), ""]);
		setValue("memberPhone", [...(getValues("memberPhone") ?? []), ""]);
		setValue("memberGender", [...(getValues("memberGender") ?? []), ""]);
		setValue("memberRole", [...(getValues("memberRole") ?? []), ""]);
	};

	const removeMember = (index: number) => {
		if ((getValues("memberName") ?? []).length <= 1) return;
		const filterArr = (arr: string[]) => arr.filter((_, i) => i !== index);
		setValue("memberName", filterArr(getValues("memberName") ?? []));
		setValue("memberEmail", filterArr(getValues("memberEmail") ?? []));
		setValue("memberPhone", filterArr(getValues("memberPhone") ?? []));
		setValue("memberGender", filterArr(getValues("memberGender") ?? []));
		setValue("memberRole", filterArr(getValues("memberRole") ?? []));
	};

	if (isApproved) {
		return (
			<div className="space-y-10">
				<PanelHeader
					eyebrow="Step 01"
					title="Team registration"
					description="Your team has been locked for changes."
				/>
				<Card>
					<CardContent className="py-8">
						<div className="flex flex-col items-center justify-center text-center">
							<AlertCircle className="mb-3 h-12 w-12 text-success opacity-60" />
							<p className="mb-1 font-medium text-success">
								Your team has been shortlisted / approved
							</p>
							<p className="text-sm text-muted-foreground">
								Contact your institution lead if changes are needed.
							</p>
						</div>
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<div className="space-y-10">
			<StepIndicator steps={steps} />

			<PanelHeader
				eyebrow="Step 01"
				title={team ? "Update team registration" : "Register team"}
				description={
					team
						? "Update your team details for VisionHack 2026."
						: "Register your team for VisionHack 2026."
				}
			/>

			{!registrationOpen && (
				<div className="rounded-md border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-warning">
					<AlertCircle className="mr-2 inline h-4 w-4" />
					Registration is currently closed. You can view your details but cannot make changes.
				</div>
			)}

			{actionData?.success && (
				<div className="rounded-md border border-success/30 bg-success/8 px-4 py-3 text-sm text-success">
					Team {team ? "updated" : "registered"} successfully!
				</div>
			)}

			{actionData?.error && (
				<div className="rounded-md border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
					{actionData.error}
				</div>
			)}

			<Form method="post" className="space-y-6">
				{/* Team Lead Info */}
				<Card>
					<CardHeader>
						<CardTitle>Team Lead Information</CardTitle>
						<CardDescription>Your personal details</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						<fieldset>
							<legend className="sr-only">Team lead personal details</legend>
							<div className="space-y-2">
								<Label htmlFor="teamName">Team Name</Label>
								<Input
									id="teamName"
									aria-invalid={!!(errors.teamName || actionData?.fieldErrors?.teamName)}
									aria-describedby={
										errors.teamName || actionData?.fieldErrors?.teamName
											? "teamName-error"
											: undefined
									}
									placeholder="Enter your team name"
									{...register("teamName")}
									disabled={!registrationOpen}
									required
								/>
								{(errors.teamName || actionData?.fieldErrors?.teamName) && (
									<p id="teamName-error" className="text-sm text-destructive" role="alert">
										{errors.teamName?.message ?? actionData?.fieldErrors?.teamName}
									</p>
								)}
							</div>

							<Separator className="my-2" />

							<div className="grid gap-4 md:grid-cols-2">
								<div className="space-y-2">
									<Label>Full Name</Label>
									<Input value={user.name} disabled className="bg-muted" />
								</div>
								<div className="space-y-2">
									<Label>Email</Label>
									<Input value={user.email} disabled className="bg-muted" />
								</div>
								<div className="space-y-2">
									<Label htmlFor="leadPhone">Phone</Label>
									<Input
										id="leadPhone"
										aria-invalid={!!(errors.leadPhone || actionData?.fieldErrors?.leadPhone)}
										aria-describedby={
											errors.leadPhone || actionData?.fieldErrors?.leadPhone
												? "leadPhone-hint leadPhone-error"
												: "leadPhone-hint"
										}
										placeholder="+91 1234567890"
										{...register("leadPhone")}
										disabled={!registrationOpen}
										required
									/>
									<p id="leadPhone-hint" className="text-xs text-muted-foreground">
										Enter your 10-digit phone number with country code
									</p>
									{(errors.leadPhone || actionData?.fieldErrors?.leadPhone) && (
										<p id="leadPhone-error" className="text-sm text-destructive" role="alert">
											{errors.leadPhone?.message ?? actionData?.fieldErrors?.leadPhone}
										</p>
									)}
								</div>
								<div className="space-y-2">
									<Controller
										control={control}
										name="leadGender"
										render={({ field }) => (
											<Select
												value={field.value ?? ""}
												onValueChange={field.onChange}
												disabled={!registrationOpen}
												name={field.name}
											>
												<SelectTrigger
													id="leadGender"
													aria-invalid={
														!!(errors.leadGender || actionData?.fieldErrors?.leadGender)
													}
													aria-describedby={
														errors.leadGender || actionData?.fieldErrors?.leadGender
															? "leadGender-error"
															: undefined
													}
												>
													<SelectValue placeholder="Select gender" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="Male">Male</SelectItem>
													<SelectItem value="Female">Female</SelectItem>
													<SelectItem value="Other">Other</SelectItem>
												</SelectContent>
											</Select>
										)}
									/>
									{(errors.leadGender || actionData?.fieldErrors?.leadGender) && (
										<p id="leadGender-error" className="text-sm text-destructive" role="alert">
											{errors.leadGender?.message ?? actionData?.fieldErrors?.leadGender}
										</p>
									)}
								</div>
								<div className="space-y-2">
									<Input
										id="leadRole"
										aria-invalid={!!(errors.leadRole || actionData?.fieldErrors?.leadRole)}
										aria-describedby={
											errors.leadRole || actionData?.fieldErrors?.leadRole
												? "leadRole-error"
												: undefined
										}
										placeholder="e.g., Team Lead, Full Stack Developer"
										{...register("leadRole")}
										disabled={!registrationOpen}
										required
									/>
									{(errors.leadRole || actionData?.fieldErrors?.leadRole) && (
										<p id="leadRole-error" className="text-sm text-destructive" role="alert">
											{errors.leadRole?.message ?? actionData?.fieldErrors?.leadRole}
										</p>
									)}
								</div>
							</div>
						</fieldset>
					</CardContent>
				</Card>

				{/* Team Members */}
				<Card>
					<CardHeader>
						<div className="flex items-center justify-between">
							<CardTitle className="flex items-center gap-2">
								<UserPlus className="h-5 w-5" />
								Team Members ({memberCount})
							</CardTitle>
							{memberCount < 5 && registrationOpen && (
								<Button type="button" variant="outline" size="sm" onClick={addMember}>
									<UserPlus className="mr-2 h-4 w-4" />
									Add Member
								</Button>
							)}
						</div>
						<CardDescription>
							Add 1&ndash;5 team members (excluding the team leader)
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-6">
						{actionData?.fieldErrors?.members && (
							<p id="members-error" className="text-sm text-destructive" role="alert">
								{actionData.fieldErrors.members}
							</p>
						)}
						{errors.memberName?.root?.message && (
							<p className="text-sm text-destructive" role="alert">
								{errors.memberName.root.message}
							</p>
						)}

						{Array.from({ length: memberCount }, (_, index) => {
							const slotId = `member-slot-${index}`;
							return (
								<fieldset
									key={slotId}
									className="rounded-md border border-border bg-background p-4 space-y-4"
								>
									<div className="flex items-center justify-between">
										<legend className="text-sm font-semibold text-foreground">
											<span className="inline-flex items-center gap-2">
												<span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
													Member
												</span>
												<span className="font-mono text-xs tabular-nums text-primary">
													{String(index + 1).padStart(2, "0")}
												</span>
											</span>
										</legend>
										{memberCount > 1 && registrationOpen && (
											<button
												type="button"
												onClick={() => removeMember(index)}
												className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-danger hover:bg-danger/8 transition-colors"
											>
												Remove
											</button>
										)}
									</div>

									<div className="grid gap-4 md:grid-cols-2">
										<div className="space-y-2">
											<Label htmlFor={`member-name-${index}`}>Full Name</Label>
											<Input
												id={`member-name-${index}`}
												placeholder="Full name"
												{...register(`memberName.${index}`)}
												disabled={!registrationOpen}
												required
											/>
											{errors.memberName?.[index]?.message && (
												<p className="text-sm text-destructive" role="alert">
													{errors.memberName[index]?.message}
												</p>
											)}
										</div>
										<div className="space-y-2">
											<Label htmlFor={`member-email-${index}`}>Email</Label>
											<Input
												id={`member-email-${index}`}
												type="email"
												placeholder="email@example.com"
												{...register(`memberEmail.${index}`)}
												disabled={!registrationOpen}
												required
											/>
											{errors.memberEmail?.[index]?.message && (
												<p className="text-sm text-destructive" role="alert">
													{errors.memberEmail[index]?.message}
												</p>
											)}
										</div>
										<div className="space-y-2">
											<Label htmlFor={`member-phone-${index}`}>Phone</Label>
											<Input
												id={`member-phone-${index}`}
												placeholder="+91 1234567890"
												{...register(`memberPhone.${index}`)}
												disabled={!registrationOpen}
												required
											/>
											{errors.memberPhone?.[index]?.message && (
												<p className="text-sm text-destructive" role="alert">
													{errors.memberPhone[index]?.message}
												</p>
											)}
										</div>
										<div className="space-y-2">
											<Label htmlFor={`member-gender-${index}`}>Gender</Label>
											<Controller
												control={control}
												// biome-ignore lint/suspicious/noExplicitAny: dynamic field path required by Controller
												name={`memberGender.${index}` as any}
												render={({ field }) => (
													<Select
														value={field.value ?? ""}
														onValueChange={field.onChange}
														disabled={!registrationOpen}
														name={field.name}
													>
														<SelectTrigger id={`member-gender-${index}`}>
															<SelectValue placeholder="Select gender" />
														</SelectTrigger>
														<SelectContent>
															<SelectItem value="Male">Male</SelectItem>
															<SelectItem value="Female">Female</SelectItem>
															<SelectItem value="Other">Other</SelectItem>
														</SelectContent>
													</Select>
												)}
											/>
											{errors.memberGender?.[index]?.message && (
												<p className="text-sm text-destructive" role="alert">
													{errors.memberGender[index]?.message}
												</p>
											)}
										</div>
										<div className="space-y-2 md:col-span-2">
											<Label htmlFor={`member-role-${index}`}>Role</Label>
											<Input
												id={`member-role-${index}`}
												placeholder="e.g., Developer, Designer, Manager"
												{...register(`memberRole.${index}`)}
												disabled={!registrationOpen}
												required
											/>
											{errors.memberRole?.[index]?.message && (
												<p className="text-sm text-destructive" role="alert">
													{errors.memberRole[index]?.message}
												</p>
											)}
										</div>
									</div>
								</fieldset>
							);
						})}
					</CardContent>
				</Card>

				{/* Review Summary */}
				<ReviewSummary open={showReview} onToggle={setShowReview}>
					<div>
						<p className="font-medium text-muted-foreground">Team Name</p>
						<p>{getValues("teamName") || "(not set)"}</p>
					</div>
					<div className="grid gap-3 sm:grid-cols-2">
						<div>
							<p className="font-medium text-muted-foreground">Lead Phone</p>
							<p>{getValues("leadPhone") || "(not set)"}</p>
						</div>
						<div>
							<p className="font-medium text-muted-foreground">Lead Gender</p>
							<p>{getValues("leadGender") || "(not set)"}</p>
						</div>
						<div>
							<p className="font-medium text-muted-foreground">Lead Role</p>
							<p>{getValues("leadRole") || "(not set)"}</p>
						</div>
					</div>
					<div>
						<p className="font-medium text-muted-foreground">Members ({memberCount})</p>
						{memberCount === 0 ? (
							<p className="text-muted-foreground italic">No members added</p>
						) : (
							<ul className="mt-1 space-y-1">
								{Array.from({ length: memberCount }, (_, i) => {
									// biome-ignore lint/suspicious/noExplicitAny: dynamic field path required by getValues
									const name = getValues(`memberName.${i}` as any);
									// biome-ignore lint/suspicious/noExplicitAny: dynamic field path required by getValues
									const email = getValues(`memberEmail.${i}` as any);
									// biome-ignore lint/suspicious/noExplicitAny: dynamic field path required by getValues
									const role = getValues(`memberRole.${i}` as any);
									return (
										// biome-ignore lint/suspicious/noArrayIndexKey: stable index for non-reorderable form fields
										<li key={i} className="flex items-center gap-1 text-muted-foreground">
											<span className="font-medium text-foreground">
												{name || `Member ${i + 1}`}
											</span>
											{email && <span>— {email}</span>}
											{role && <span>({role})</span>}
										</li>
									);
								})}
							</ul>
						)}
					</div>
				</ReviewSummary>

				{/* Submit */}
				{registrationOpen && (
					<Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
						{isSubmitting ? (
							<Loader2 className="mr-2 h-4 w-4 vh-spin" />
						) : (
							<Save className="mr-2 h-4 w-4" />
						)}
						{isSubmitting
							? team
								? "Updating..."
								: "Registering..."
							: team
								? "Update Team"
								: "Register Team"}
					</Button>
				)}
			</Form>
		</div>
	);
}

export function ErrorBoundary() {
	const error = useRouteError();
	let message = "Something went wrong";
	if (isRouteErrorResponse(error)) {
		message = `Error ${error.status} — ${error.statusText || "Access denied"}`;
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
