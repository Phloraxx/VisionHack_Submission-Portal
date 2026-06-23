import { zodResolver } from "@hookform/resolvers/zod";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
import { StepIndicator, getStatusStepStates, resolveActiveStep } from "~/components/shared/step-indicator";
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
import { Textarea } from "~/components/ui/textarea";
import { fail, ok, secureAction } from "~/lib/action.server";
import { getConfig } from "~/lib/config.server";
import { secureLoader } from "~/lib/loader.server";
import { type QuestionnaireInput, questionnaireSchema } from "~/lib/schemas/questionnaire";
import { getLeadTeam } from "~/lib/team.server";
import type { TeamRecord } from "~/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuestionnaireData {
	id?: string;
	teamId: string;
	userId: string;
	age?: string;
	gender?: string;
	education?: string;
	college_name?: string;
	district?: string;
	skills?: string;
	interests?: string;
	challenges?: string;
	experience?: string;
	motivation?: string;
	team_experience?: string;
	expectations?: string;
	additional_info?: string;
}

interface LoaderData {
	user: { id: string; name: string; email: string };
	team: TeamRecord | null;
	questionnaire: QuestionnaireData | null;
	questionnaireOpen: boolean;
}

interface ActionData {
	success?: boolean;
	error?: string;
	fieldErrors?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECTIONS = [
	{ id: "personal", title: "Personal Info" },
	{ id: "skills", title: "Skills & Interests" },
	{ id: "motivation", title: "Motivation" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = secureLoader({ roles: ["lead"] }, async ({ user, pb }) => {
	// Team and config are independent — fetch in parallel.
	const [team, flags] = await Promise.all([getLeadTeam<TeamRecord>(pb, user.id), getConfig(pb)]);

	const questionnaire: QuestionnaireData | null = team
		? await pb
				.collection("questionnaire_responses")
				.getFirstListItem<QuestionnaireData>(pb.filter("teamId = {:teamId}", { teamId: team.id }))
				.catch(() => null)
		: null;

	return {
		user,
		team,
		questionnaire,
		questionnaireOpen: flags.questionnaire_open ?? false,
	} satisfies LoaderData;
});

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = secureAction(
	{ roles: ["lead"], schema: questionnaireSchema },
	async ({ formData, user, pb, validated }) => {
		const flags = await getConfig(pb);
		if (!flags.questionnaire_open) {
			return fail({ error: "Questionnaire is currently closed", status: 403 });
		}

		const {
			age,
			gender,
			education,
			college_name: collegeName,
			district,
			skills = "",
			interests = "",
			challenges = "",
			experience = "",
			motivation = "",
			team_experience: teamExperience = "",
			expectations = "",
			additional_info: additionalInfo = "",
		} = validated as QuestionnaireInput;
		// Find team
		const team = await getLeadTeam<TeamRecord>(pb, user.id, {
			fields: "id,status,questionnaire_completed",
		});
		if (!team) return fail({ error: "Team not found", status: 404 });

		if (team.status === "withdrawn" || team.status === "rejected") {
			return fail({ error: "Cannot submit questionnaire for a team in this status", status: 403 });
		}

		// Upsert response
		const existing = await pb
			.collection("questionnaire_responses")
			.getFirstListItem(pb.filter("teamId = {:teamId}", { teamId: team.id }), {
				fields: "id",
			})
			.catch(() => null);

		const payload: Record<string, unknown> = {
			teamId: team.id,
			userId: user.id,
			age: Number(age),
			gender,
			education,
			college_name: collegeName.slice(0, 200),
			district: district.slice(0, 100),
			skills: skills.slice(0, 1000),
			interests: interests.slice(0, 1000),
			challenges: challenges.slice(0, 2000),
			experience: experience.slice(0, 2000),
			motivation: motivation.slice(0, 2000),
			team_experience: teamExperience.slice(0, 2000),
			expectations: expectations.slice(0, 2000),
			additional_info: additionalInfo.slice(0, 2000),
		};

		if (existing) {
			await pb.collection("questionnaire_responses").update(existing.id, payload);
		} else {
			await pb.collection("questionnaire_responses").create(payload);
		}

		// Denormalize: mark the team as having completed the questionnaire
		// so the rest of the app can read it without a join.
		if (!team.questionnaire_completed) {
			await pb.collection("teams").update(team.id, {
				questionnaire_completed: true,
			});
		}

		return ok();
	},
);

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export function meta() {
	return [{ title: "Step 2 of 3: Questionnaire — VisionHack" }];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeadQuestionnaire() {
	const { team, questionnaire, questionnaireOpen } = useLoaderData() as LoaderData;
	const actionData = useActionData() as ActionData | undefined;
	const navigation = useNavigation();
	const isSubmitting = navigation.state === "submitting";

	// Form state
	const {
		register,
		control,
		formState: { errors },
	} = useForm({
		resolver: zodResolver(questionnaireSchema),
		defaultValues: {
			age: questionnaire?.age?.toString() ?? "",
			gender: questionnaire?.gender ?? "",
			education: questionnaire?.education ?? "",
			college_name: questionnaire?.college_name ?? "",
			district: questionnaire?.district ?? "",
			skills: questionnaire?.skills ?? "",
			interests: questionnaire?.interests ?? "",
			challenges: questionnaire?.challenges ?? "",
			experience: questionnaire?.experience ?? "",
			motivation: questionnaire?.motivation ?? "",
			team_experience: questionnaire?.team_experience ?? "",
			expectations: questionnaire?.expectations ?? "",
			additional_info: questionnaire?.additional_info ?? "",
		},
	});

	const [currentSection, setCurrentSection] = useState<SectionId>("personal");
	const topRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		topRef.current?.scrollIntoView({ behavior: "smooth" });
	}, [currentSection]);

	const steps = resolveActiveStep(getStatusStepStates(team?.status ?? null), "/lead/questionnaire");

	if (!team) {
		return (
			<div className="space-y-10">
				<PanelHeader
					eyebrow="Step 02"
					title="Questionnaire"
					description="Complete your team profile questionnaire."
				/>
				<Card>
					<CardContent className="py-8 text-center">
						<AlertCircle className="mx-auto mb-3 h-12 w-12 text-muted-foreground opacity-30" />
						<p className="font-medium">Please register your team first</p>
						<p className="text-sm text-muted-foreground">
							You need to register a team before filling the questionnaire.
						</p>
					</CardContent>
				</Card>
			</div>
		);
	}

	const sectionIds: SectionId[] = SECTIONS.map((s) => s.id);
	const currentIdx = sectionIds.indexOf(currentSection);
	const isFirstSection = currentIdx === 0;
	const isLastSection = currentIdx === sectionIds.length - 1;

	const goNext = () => {
		if (currentIdx < sectionIds.length - 1) {
			setCurrentSection(sectionIds[currentIdx + 1]);
		}
	};

	const goPrev = () => {
		if (currentIdx > 0) {
			setCurrentSection(sectionIds[currentIdx - 1]);
		}
	};

	const handleTabKeyDown = (
		e: React.KeyboardEvent,
		sectionIds: SectionId[],
		currentIdx: number,
	) => {
		if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
			e.preventDefault();
			const nextIdx =
				e.key === "ArrowRight"
					? Math.min(currentIdx + 1, sectionIds.length - 1)
					: Math.max(currentIdx - 1, 0);
			if (nextIdx !== currentIdx) {
				setCurrentSection(sectionIds[nextIdx]);
			}
		}
	};

	return (
		<div className="space-y-10" ref={topRef}>
			<StepIndicator steps={steps} />

			<PanelHeader
				eyebrow="Step 02"
				title="Team questionnaire"
				description="Complete this questionnaire to help us understand your team better."
			/>

			{!questionnaireOpen && (
				<div className="rounded-md border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-warning">
					<AlertCircle className="mr-2 inline h-4 w-4" />
					Questionnaire submissions are currently closed. You can view your answers but cannot make
					changes.
				</div>
			)}

			{actionData?.success && (
				<div className="rounded-md border border-success/30 bg-success/8 px-4 py-3 text-sm text-success">
					Questionnaire saved successfully!
				</div>
			)}

			{actionData?.error && (
				<div className="rounded-md border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
					{actionData.error}
				</div>
			)}
			<div
				className="flex gap-2"
				role="tablist"
				onKeyDown={(e) => handleTabKeyDown(e, sectionIds, currentIdx)}
			>
				{SECTIONS.map((s, i) => (
					<button
						key={s.id}
						type="button"
						role="tab"
						id={`section-tab-${s.id}`}
						aria-selected={currentSection === s.id}
						aria-controls={`section-panel-${s.id}`}
						tabIndex={currentSection === s.id ? 0 : -1}
						onClick={() => setCurrentSection(s.id)}
						className={`flex-1 rounded-lg px-3 py-2 text-center text-sm font-medium transition-colors ${
							currentSection === s.id
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground hover:bg-muted/80"
						}`}
					>
						{i + 1}. {s.title}
					</button>
				))}
			</div>

			<Form method="post" className="space-y-6">
				{/* Render ALL sections but hide non-current with CSS so all form fields submit */}
				<div
					style={{ display: currentSection === "personal" ? undefined : "none" }}
					role="tabpanel"
					id="section-panel-personal"
					aria-labelledby="section-tab-personal"
				>
					<Card key="personal" className="panel-enter">
						<CardHeader>
							<CardTitle>Personal Info</CardTitle>
							<CardDescription>Tell us about yourself</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="grid gap-4 md:grid-cols-2">
								<div className="space-y-2">
									<Label htmlFor="age">
										Age <span className="text-destructive">*</span>
									</Label>
									<Input
										id="age"
										aria-invalid={!!(errors.age || actionData?.fieldErrors?.age)}
										aria-describedby={
											errors.age || actionData?.fieldErrors?.age ? "age-error" : undefined
										}
										type="number"
										placeholder="Your age"
										{...register("age")}
										disabled={!questionnaireOpen}
										required
									/>
									{(errors.age || actionData?.fieldErrors?.age) && (
										<p id="age-error" className="text-sm text-destructive" role="alert">
											{errors.age?.message ?? actionData?.fieldErrors?.age}
										</p>
									)}
								</div>
								<div className="space-y-2">
									<Label htmlFor="gender">
										Gender <span className="text-destructive">*</span>
									</Label>
									<Controller
										control={control}
										name="gender"
										render={({ field }) => (
											<Select
												value={field.value ?? ""}
												onValueChange={field.onChange}
												disabled={!questionnaireOpen}
												name={field.name}
											>
												<SelectTrigger
													id="gender"
													aria-invalid={!!(errors.gender || actionData?.fieldErrors?.gender)}
													aria-describedby={
														errors.gender || actionData?.fieldErrors?.gender
															? "gender-error"
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
									{(errors.gender || actionData?.fieldErrors?.gender) && (
										<p id="gender-error" className="text-sm text-destructive" role="alert">
											{errors.gender?.message ?? actionData?.fieldErrors?.gender}
										</p>
									)}
								</div>
							</div>
							<div className="space-y-2">
								<Label htmlFor="college_name">
									College Name <span className="text-destructive">*</span>
								</Label>
								<Input
									id="college_name"
									aria-invalid={!!(errors.college_name || actionData?.fieldErrors?.college_name)}
									aria-describedby={
										errors.college_name || actionData?.fieldErrors?.college_name
											? "college_name-error"
											: undefined
									}
									placeholder="Your college name"
									{...register("college_name")}
									disabled={!questionnaireOpen}
									required
								/>
								{(errors.college_name || actionData?.fieldErrors?.college_name) && (
									<p id="college_name-error" className="text-sm text-destructive" role="alert">
										{errors.college_name?.message ?? actionData?.fieldErrors?.college_name}
									</p>
								)}
							</div>
							<div className="space-y-2">
								<Label htmlFor="education">
									Education <span className="text-destructive">*</span>
								</Label>
								<Controller
									control={control}
									name="education"
									render={({ field }) => (
										<Select
											value={field.value ?? ""}
											onValueChange={field.onChange}
											disabled={!questionnaireOpen}
											name={field.name}
										>
											<SelectTrigger
												id="education"
												aria-invalid={!!(errors.education || actionData?.fieldErrors?.education)}
												aria-describedby={
													errors.education || actionData?.fieldErrors?.education
														? "education-error"
														: undefined
												}
											>
												<SelectValue placeholder="Select education" />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="High School">High School</SelectItem>
												<SelectItem value="Higher Secondary">Higher Secondary</SelectItem>
												<SelectItem value="Undergraduate">Undergraduate</SelectItem>
												<SelectItem value="Postgraduate">Postgraduate</SelectItem>
												<SelectItem value="Other">Other</SelectItem>
											</SelectContent>
										</Select>
									)}
								/>
								{(errors.education || actionData?.fieldErrors?.education) && (
									<p id="education-error" className="text-sm text-destructive" role="alert">
										{errors.education?.message ?? actionData?.fieldErrors?.education}
									</p>
								)}
							</div>
							<div className="space-y-2">
								<Label htmlFor="district">
									District <span className="text-destructive">*</span>
								</Label>
								<Input
									id="district"
									aria-invalid={!!(errors.district || actionData?.fieldErrors?.distrct)}
									aria-describedby={
										errors.district || actionData?.fieldErrors?.district
											? "district-error"
											: undefined
									}
									placeholder="Your district"
									{...register("district")}
									disabled={!questionnaireOpen}
									required
								/>
								{(errors.district || actionData?.fieldErrors?.district) && (
									<p id="district-error" className="text-sm text-destructive" role="alert">
										{errors.district?.message ?? actionData?.fieldErrors?.district}
									</p>
								)}
							</div>
							<div className="space-y-2">
								<Label htmlFor="year_of_graduation">
									Year of Graduation <span className="text-destructive">*</span>
								</Label>
								<Input
									id="year_of_graduation"
									type="number"
									placeholder="e.g. 2028"
									{...register("year_of_graduation")}
									disabled={!questionnaireOpen}
									required
								/>
								{(errors.year_of_graduation || actionData?.fieldErrors?.year_of_graduation) && (
									<p
										id="year-of-graduation-error"
										className="text-sm text-destructive"
										role="alert"
									>
										{errors.year_of_graduation?.message ??
											actionData?.fieldErrors?.year_of_graduation}
									</p>
								)}
							</div>
						</CardContent>
					</Card>
				</div>
				<div
					style={{ display: currentSection === "skills" ? undefined : "none" }}
					role="tabpanel"
					id="section-panel-skills"
					aria-labelledby="section-tab-skills"
				>
					<Card key="skills" className="panel-enter">
						<CardHeader>
							<CardTitle>Skills &amp; Interests</CardTitle>
							<CardDescription>Tell us about your skills and interests</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="skills">Skills</Label>
								<Textarea
									id="skills"
									maxLength={1000}
									placeholder="List your technical and non-technical skills"
									{...register("skills")}
									disabled={!questionnaireOpen}
									className="min-h-[100px]"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="interests">Interests</Label>
								<Textarea
									id="interests"
									maxLength={1000}
									placeholder="What are you passionate about?"
									{...register("interests")}
									disabled={!questionnaireOpen}
									className="min-h-[100px]"
								/>
							</div>
						</CardContent>
					</Card>
				</div>
				<div
					style={{ display: currentSection === "motivation" ? undefined : "none" }}
					role="tabpanel"
					id="section-panel-motivation"
					aria-labelledby="section-tab-motivation"
				>
					<Card key="motivation" className="panel-enter">
						<CardHeader>
							<CardTitle>Motivation</CardTitle>
							<CardDescription>Tell us about your journey and aspirations</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="space-y-2">
								<Label htmlFor="challenges">Challenges Faced</Label>
								<Textarea
									id="challenges"
									maxLength={2000}
									placeholder="What challenges have you faced?"
									{...register("challenges")}
									disabled={!questionnaireOpen}
									className="min-h-[80px]"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="experience">Previous Experience</Label>
								<Textarea
									id="experience"
									maxLength={2000}
									placeholder="Describe any previous hackathon, project, or work experience"
									{...register("experience")}
									disabled={!questionnaireOpen}
									className="min-h-[80px]"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="motivation">Why do you want to participate?</Label>
								<Textarea
									id="motivation"
									maxLength={2000}
									placeholder="What motivates you to join VisionHack?"
									{...register("motivation")}
									disabled={!questionnaireOpen}
									className="min-h-[80px]"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="team_experience">Teamwork Experience</Label>
								<Textarea
									id="team_experience"
									maxLength={2000}
									placeholder="Describe your experience working in teams"
									{...register("team_experience")}
									disabled={!questionnaireOpen}
									className="min-h-[80px]"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="expectations">Expectations from VisionHack</Label>
								<Textarea
									id="expectations"
									maxLength={2000}
									placeholder="What do you hope to gain?"
									{...register("expectations")}
									disabled={!questionnaireOpen}
									className="min-h-[80px]"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="additional_info">Additional Information</Label>
								<Textarea
									id="additional_info"
									maxLength={2000}
									placeholder="Anything else you'd like to share?"
									{...register("additional_info")}
									disabled={!questionnaireOpen}
									className="min-h-[80px]"
								/>
							</div>
						</CardContent>
					</Card>
				</div>

				{/* Navigation buttons */}
				<div className="flex items-center justify-between">
					<Button type="button" variant="outline" onClick={goPrev} disabled={isFirstSection}>
						<ChevronLeft className="mr-2 h-4 w-4" /> Previous
					</Button>
					{isLastSection ? (
						<Button type="submit" disabled={isSubmitting || !questionnaireOpen}>
							{isSubmitting ? (
								<Loader2 className="mr-2 h-4 w-4 vh-spin" />
							) : (
								<Send className="mr-2 h-4 w-4" />
							)}
							{isSubmitting
								? "Saving..."
								: questionnaire
									? "Update Questionnaire"
									: "Submit Questionnaire"}
						</Button>
					) : (
						<Button type="button" onClick={goNext}>
							Next <ChevronRight className="ml-2 h-4 w-4" />
						</Button>
					)}
				</div>
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
					onClick={() => window.location.reload()}
					className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity"
				>
					Try again
				</button>
			</div>
		</div>
	);
}
