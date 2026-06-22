import { useState, useRef, useEffect } from "react";
import {
  useLoaderData,
  Form,
  useNavigation,
  useActionData,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { secureAction, fail, ok } from "~/lib/action.server";
import { getConfig } from "~/lib/config.server";
import { getLeadTeam } from "~/lib/team.server";
import { getStr } from "~/lib/form.server";
import type { TeamRecord } from "~/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Send,
} from "lucide-react";
import { StepIndicator, getLeadSteps } from "~/components/shared/step-indicator";
import { PanelHeader } from "~/components/shared/panel-header";

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

export async function loader({ request }: LoaderFunctionArgs) {
  const { pb, user } = await requireRole(request, ["lead"]);

  // Team and config are independent — fetch in parallel.
  const [team, flags] = await Promise.all([
    getLeadTeam<TeamRecord>(pb, user.id),
    getConfig(pb),
  ]);

  const questionnaire: QuestionnaireData | null = team
    ? await pb
        .collection("questionnaire_responses")
        .getFirstListItem<QuestionnaireData>(
          pb.filter("teamId = {:teamId}", { teamId: team.id }),
        )
        .catch(() => null)
    : null;

  return {
    user,
    team,
    questionnaire,
    questionnaireOpen: flags.questionnaire_open ?? false,
  } satisfies LoaderData;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

const MAX_TEXT = 2000; // matches schema max for free-text fields

export const action = secureAction({ roles: ["lead"] }, async ({ formData, user, pb }) => {
  const flags = await getConfig(pb);
  if (!flags.questionnaire_open) {
    return fail({ error: "Questionnaire is currently closed", status: 403 });
  }

  const age = getStr(formData, "age", { trim: false });
  const gender = getStr(formData, "gender", { trim: false });
  const education = getStr(formData, "education", { trim: false });
  const collegeName = getStr(formData, "college_name");
  const district = getStr(formData, "district");
  const skills = getStr(formData, "skills", { trim: false });
  const interests = getStr(formData, "interests", { trim: false });
  const challenges = getStr(formData, "challenges", { trim: false });
  const experience = getStr(formData, "experience", { trim: false });
  const motivation = getStr(formData, "motivation", { trim: false });
  const teamExperience = getStr(formData, "team_experience", { trim: false });
  const expectations = getStr(formData, "expectations", { trim: false });
  const additionalInfo = getStr(formData, "additional_info", { trim: false });

  // Validate
  const fieldErrors: Record<string, string> = {};
  if (!age) fieldErrors.age = "Age is required";
  else if (Number.isNaN(Number(age)) || Number(age) < 10 || Number(age) > 100) {
    fieldErrors.age = "Enter a valid age";
  }
  if (!gender) fieldErrors.gender = "Gender is required";
  if (!education) fieldErrors.education = "Education is required";
  if (!collegeName) fieldErrors.college_name = "College name is required";
  else if (collegeName.length > 200) fieldErrors.college_name = "College name too long";
  if (!district) fieldErrors.district = "District is required";
  else if (district.length > 100) fieldErrors.district = "District name too long";

  const textLimits: Array<[string, string, number]> = [
    ["skills", skills, 1000],
    ["interests", interests, 1000],
    ["challenges", challenges, MAX_TEXT],
    ["experience", experience, MAX_TEXT],
    ["motivation", motivation, MAX_TEXT],
    ["team_experience", teamExperience, MAX_TEXT],
    ["expectations", expectations, MAX_TEXT],
    ["additional_info", additionalInfo, MAX_TEXT],
  ];
  for (const [key, value, max] of textLimits) {
    if (value.length > max) fieldErrors[key] = `${key} must be under ${max} characters`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return fail({ fieldErrors });
  }

  // Find team
  const team = await getLeadTeam<TeamRecord>(pb, user.id, {
    fields: "id,status,questionnaire_completed",
  });
  if (!team) return fail({ error: "Team not found", status: 404 });

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
    challenges: challenges.slice(0, MAX_TEXT),
    experience: experience.slice(0, MAX_TEXT),
    motivation: motivation.slice(0, MAX_TEXT),
    team_experience: teamExperience.slice(0, MAX_TEXT),
    expectations: expectations.slice(0, MAX_TEXT),
    additional_info: additionalInfo.slice(0, MAX_TEXT),
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
});

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
  const { team, questionnaire, questionnaireOpen } =
    useLoaderData() as LoaderData;
  const actionData = useActionData() as ActionData | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [currentSection, setCurrentSection] = useState<SectionId>("personal");
  const topRef = useRef<HTMLDivElement>(null);

  // Form state
  const [formValues, setFormValues] = useState({
    age: questionnaire?.age ?? "",
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
  });

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [currentSection]);

  const steps = getLeadSteps(team?.status ?? null, "/lead/questionnaire");

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

  const updateField = (field: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
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
          Questionnaire submissions are currently closed. You can view your
          answers but cannot make changes.
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
        onKeyDown={(e) =>
          handleTabKeyDown(e, sectionIds, currentIdx)
        }
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
        {/* Section 1: Personal Info */}
        {currentSection === "personal" && (
          <Card key="personal" className="panel-enter" role="tabpanel" id="section-panel-personal" aria-labelledby="section-tab-personal">
            <CardHeader>
              <CardTitle>Personal Info</CardTitle>
              <CardDescription>
                Tell us about yourself
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="age">
                    Age <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="age"
                    aria-invalid={!!actionData?.fieldErrors?.age}
                    aria-describedby={actionData?.fieldErrors?.age ? "age-error" : undefined}
                    name="age"
                    type="number"
                    placeholder="Your age"
                    value={formValues.age}
                    onChange={(e) => updateField("age", e.target.value)}
                    disabled={!questionnaireOpen}
                    required
                  />
                  {actionData?.fieldErrors?.age && (
                    <p id="age-error" className="text-sm text-destructive" role="alert">
                      {actionData.fieldErrors.age}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="gender">
                    Gender <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={formValues.gender}
                    onValueChange={(v) => updateField("gender", v)}
                    disabled={!questionnaireOpen}
                    name="gender"
                  >
                    <SelectTrigger id="gender" aria-invalid={!!actionData?.fieldErrors?.gender} aria-describedby={actionData?.fieldErrors?.gender ? "gender-error" : undefined}>
                      <SelectValue placeholder="Select gender" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {actionData?.fieldErrors?.gender && (
                    <p id="gender-error" className="text-sm text-destructive" role="alert">
                      {actionData.fieldErrors.gender}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="education">
                    Education <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={formValues.education}
                    onValueChange={(v) => updateField("education", v)}
                    disabled={!questionnaireOpen}
                    name="education"
                  >
                    <SelectTrigger id="education" aria-invalid={!!actionData?.fieldErrors?.education} aria-describedby={actionData?.fieldErrors?.education ? "education-error" : undefined}>
                      <SelectValue placeholder="Select education" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="High School">
                        High School
                      </SelectItem>
                      <SelectItem value="Higher Secondary">
                        Higher Secondary
                      </SelectItem>
                      <SelectItem value="Undergraduate">
                        Undergraduate
                      </SelectItem>
                      <SelectItem value="Postgraduate">
                        Postgraduate
                      </SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {actionData?.fieldErrors?.education && (
                    <p id="education-error" className="text-sm text-destructive" role="alert">
                      {actionData.fieldErrors.education}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="college_name">
                    College Name{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="college_name"
                    aria-invalid={!!actionData?.fieldErrors?.college_name}
                    aria-describedby={actionData?.fieldErrors?.college_name ? "college_name-error" : undefined}
                    name="college_name"
                    placeholder="Your college name"
                    value={formValues.college_name}
                    onChange={(e) =>
                      updateField("college_name", e.target.value)
                    }
                    disabled={!questionnaireOpen}
                    required
                  />
                  {actionData?.fieldErrors?.college_name && (
                    <p id="college_name-error" className="text-sm text-destructive" role="alert">
                      {actionData.fieldErrors.college_name}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="district">
                    District <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="district"
                    aria-invalid={!!actionData?.fieldErrors?.district}
                    aria-describedby={actionData?.fieldErrors?.district ? "district-error" : undefined}
                    name="district"
                    placeholder="Your district"
                    value={formValues.district}
                    onChange={(e) =>
                      updateField("district", e.target.value)
                    }
                    disabled={!questionnaireOpen}
                    required
                  />
                  {actionData?.fieldErrors?.district && (
                    <p id="district-error" className="text-sm text-destructive" role="alert">
                      {actionData.fieldErrors.district}
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 2: Skills & Interests */}
        {currentSection === "skills" && (
          <Card key="skills" className="panel-enter" role="tabpanel" id="section-panel-skills" aria-labelledby="section-tab-skills">
            <CardHeader>
              <CardTitle>Skills &amp; Interests</CardTitle>
              <CardDescription>
                Tell us about your skills and interests
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="skills">Skills</Label>
                <Textarea
                  id="skills"
                  name="skills"
                  maxLength={1000}
                  placeholder="List your technical and non-technical skills (e.g., Python, UI/UX Design, Public Speaking)"
                  value={formValues.skills}
                  onChange={(e) => updateField("skills", e.target.value)}
                  disabled={!questionnaireOpen}
                  className="min-h-[100px]"
                />
                <p className="text-xs text-muted-foreground">
                  Separate skills with commas
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="interests">Interests</Label>
                <Textarea
                  id="interests"
                  name="interests"
                  maxLength={1000}
                  placeholder="What are you passionate about? (e.g., AI, Web Development, Social Impact)"
                  value={formValues.interests}
                  onChange={(e) =>
                    updateField("interests", e.target.value)
                  }
                  disabled={!questionnaireOpen}
                  className="min-h-[100px]"
                />
                <p className="text-xs text-muted-foreground">
                  Separate interests with commas
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 3: Motivation */}
        {currentSection === "motivation" && (
          <Card key="motivation" className="panel-enter" role="tabpanel" id="section-panel-motivation" aria-labelledby="section-tab-motivation">
            <CardHeader>
              <CardTitle>Motivation</CardTitle>
              <CardDescription>
                Tell us about your journey and aspirations
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="challenges">
                  Challenges Faced
                </Label>
                <Textarea
                  id="challenges"
                  name="challenges"
                  maxLength={2000}
                  placeholder="What challenges have you faced in your journey so far?"
                  value={formValues.challenges}
                  onChange={(e) =>
                    updateField("challenges", e.target.value)
                  }
                  disabled={!questionnaireOpen}
                  className="min-h-[80px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="experience">
                  Previous Experience
                </Label>
                <Textarea
                  id="experience"
                  name="experience"
                  maxLength={2000}
                  placeholder="Describe any previous hackathon, project, or work experience"
                  value={formValues.experience}
                  onChange={(e) =>
                    updateField("experience", e.target.value)
                  }
                  disabled={!questionnaireOpen}
                  className="min-h-[80px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="motivation">
                  Why do you want to participate?
                </Label>
                <Textarea
                  id="motivation"
                  name="motivation"
                  maxLength={2000}
                  placeholder="What motivates you to join VisionHack?"
                  value={formValues.motivation}
                  onChange={(e) =>
                    updateField("motivation", e.target.value)
                  }
                  disabled={!questionnaireOpen}
                  className="min-h-[80px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="team_experience">
                  Teamwork Experience
                </Label>
                <Textarea
                  id="team_experience"
                  name="team_experience"
                  maxLength={2000}
                  placeholder="Describe your experience working in teams"
                  value={formValues.team_experience}
                  onChange={(e) =>
                    updateField("team_experience", e.target.value)
                  }
                  disabled={!questionnaireOpen}
                  className="min-h-[80px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="expectations">
                  Expectations from VisionHack
                </Label>
                <Textarea
                  id="expectations"
                  name="expectations"
                  maxLength={2000}
                  placeholder="What do you hope to gain from this hackathon?"
                  value={formValues.expectations}
                  onChange={(e) =>
                    updateField("expectations", e.target.value)
                  }
                  disabled={!questionnaireOpen}
                  className="min-h-[80px]"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="additional_info">
                  Additional Information
                </Label>
                <Textarea
                  id="additional_info"
                  name="additional_info"
                  maxLength={2000}
                  placeholder="Anything else you'd like to share?"
                  value={formValues.additional_info}
                  onChange={(e) =>
                    updateField("additional_info", e.target.value)
                  }
                  disabled={!questionnaireOpen}
                  className="min-h-[80px]"
                />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Navigation buttons */}
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            onClick={goPrev}
            disabled={isFirstSection}
          >
            <ChevronLeft className="mr-2 h-4 w-4" />
            Previous
          </Button>

          {isLastSection ? (
            <Button
              type="submit"
              disabled={isSubmitting || !questionnaireOpen}
            >
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
              Next
              <ChevronRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </Form>
    </div>
  );
}

export function HydrateFallback() {
  return (
    <div className="flex items-center justify-center p-8">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

export function ErrorBoundary({ error }: { error: Error }) {
  let message = "Something went wrong";
  if (error instanceof Error) message = error.message;
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-8">
      <div className="mx-auto max-w-md text-center">
        <p className="mb-3 font-mono text-[10px] uppercase tracking-[0.2em] text-danger">Error</p>
        <h1 className="mb-2 text-xl font-semibold tracking-tight">{message}</h1>
        <button onClick={() => window.location.reload()} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">Try again</button>
      </div>
    </div>
  );
}
