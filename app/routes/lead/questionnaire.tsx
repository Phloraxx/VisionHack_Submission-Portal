import { useState, useRef, useEffect } from "react";
import {
  useLoaderData,
  Form,
  useNavigation,
  useActionData,
} from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { validateOrigin } from "~/lib/csrf.server";
import { getConfig } from "~/lib/config.server";
import type { TeamStatus, TeamRecord } from "~/lib/types";
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

  const teams = await pb
    .collection("teams")
    .getFullList<TeamRecord>({
      filter: pb.filter('leaderUserId = {:userId}', { userId: user.id }),
    });

  const team = teams.length > 0 ? teams[0] : null;
  let questionnaire: QuestionnaireData | null = null;

  if (team) {
    const responses = await pb
      .collection("questionnaire_responses")
      .getFullList<QuestionnaireData>({
        filter: pb.filter('teamId = {:teamId}', { teamId: team.id }),
      });
    if (responses.length > 0) {
      questionnaire = responses[0];
    }
  }

  const flags = await getConfig(pb);
  const questionnaireOpen = flags.questionnaire_open ?? false;

  return {
    user,
    team,
    questionnaire,
    questionnaireOpen,
  } satisfies LoaderData;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  validateOrigin(request);
  const { pb, user } = await requireRole(request, ["lead"]);

  const flags = await getConfig(pb);
  const questionnaireOpen = flags.questionnaire_open ?? false;
  if (!questionnaireOpen) {
    return Response.json(
      { error: "Questionnaire is currently closed" },
      { status: 403 },
    );
  }

  const formData = await request.formData();

  // Validate personal section
  const fieldErrors: Record<string, string> = {};
  const age = formData.get("age") as string;
  const gender = formData.get("gender") as string;
  const education = formData.get("education") as string;
  const college_name = formData.get("college_name") as string;
  const district = formData.get("district") as string;

  if (!age) fieldErrors.age = "Age is required";
  if (!gender) fieldErrors.gender = "Gender is required";
  if (!education) fieldErrors.education = "Education is required";
  if (!college_name?.trim())
    fieldErrors.college_name = "College name is required";
  else if (college_name.length > 200) fieldErrors.college_name = "College name too long";
  if (!district?.trim()) fieldErrors.district = "District is required";
  else if (district.length > 100) fieldErrors.district = "District name too long";

  const skills = (formData.get("skills") as string) ?? "";
  const interests = (formData.get("interests") as string) ?? "";
  const challenges = (formData.get("challenges") as string) ?? "";
  const experience = (formData.get("experience") as string) ?? "";
  const motivation = (formData.get("motivation") as string) ?? "";
  const team_experience = (formData.get("team_experience") as string) ?? "";
  const expectations = (formData.get("expectations") as string) ?? "";
  const additional_info = (formData.get("additional_info") as string) ?? "";

  // Length limits for textarea fields (max 5000 chars each)
  const MAX_TEXT = 5000;
  if (skills.length > MAX_TEXT) fieldErrors.skills = `Skills must be under ${MAX_TEXT} characters`;
  if (interests.length > MAX_TEXT) fieldErrors.interests = `Interests must be under ${MAX_TEXT} characters`;
  if (challenges.length > MAX_TEXT) fieldErrors.challenges = `Challenges must be under ${MAX_TEXT} characters`;
  if (experience.length > MAX_TEXT) fieldErrors.experience = `Experience must be under ${MAX_TEXT} characters`;
  if (motivation.length > MAX_TEXT) fieldErrors.motivation = `Motivation must be under ${MAX_TEXT} characters`;
  if (team_experience.length > MAX_TEXT) fieldErrors.team_experience = `Team experience must be under ${MAX_TEXT} characters`;
  if (expectations.length > MAX_TEXT) fieldErrors.expectations = `Expectations must be under ${MAX_TEXT} characters`;
  if (additional_info.length > MAX_TEXT) fieldErrors.additional_info = `Additional info must be under ${MAX_TEXT} characters`;

  if (Object.keys(fieldErrors).length > 0) {
    return Response.json({ fieldErrors }, { status: 400 });
  }

  // Find team
  const teams = await pb
    .collection("teams")
    .getFullList<TeamRecord>({
      filter: pb.filter('leaderUserId = {:userId}', { userId: user.id }),
    });

  if (teams.length === 0) {
    return Response.json({ error: "Team not found" }, { status: 404 });
  }

  const team = teams[0];

  // Find existing response
  const existingResponses = await pb
    .collection("questionnaire_responses")
    .getFullList<QuestionnaireData>({
      filter: pb.filter('teamId = {:teamId}', { teamId: team.id }),
    });

  const payload: Record<string, unknown> = {
    teamId: team.id,
    userId: user.id,
    age,
    gender,
    education,
    college_name: college_name.slice(0, 200),
    district: district.slice(0, 100),
    skills: skills.slice(0, MAX_TEXT),
    interests: interests.slice(0, MAX_TEXT),
    challenges: challenges.slice(0, MAX_TEXT),
    experience: experience.slice(0, MAX_TEXT),
    motivation: motivation.slice(0, MAX_TEXT),
    team_experience: team_experience.slice(0, MAX_TEXT),
    expectations: expectations.slice(0, MAX_TEXT),
    additional_info: additional_info.slice(0, MAX_TEXT),
  };

  if (existingResponses.length > 0) {
    await pb
      .collection("questionnaire_responses")
      .update(existingResponses[0].id!, payload);
  } else {
    await pb.collection("questionnaire_responses").create(payload);
  }

  return Response.json({ success: true });
}

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
  const { user, team, questionnaire, questionnaireOpen } =
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
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Questionnaire
          </h1>
          <p className="text-muted-foreground">
            Complete your team profile questionnaire.
          </p>
        </div>
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

  const updateField = (field: string, value: string) => {
    setFormValues((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="space-y-8" ref={topRef}>
      <StepIndicator steps={steps} />

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Team Questionnaire
        </h1>
        <p className="text-muted-foreground">
          Complete this questionnaire to help us understand your team better.
        </p>
      </div>

      {!questionnaireOpen && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          Questionnaire submissions are currently closed. You can view your
          answers but cannot make changes.
        </div>
      )}

      {actionData?.success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Questionnaire saved successfully!
        </div>
      )}

      {actionData?.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
          {actionData.error}
        </div>
      )}

      {/* Section navigation */}
      <div className="flex gap-2">
        {SECTIONS.map((s, i) => (
          <button
            key={s.id}
            type="button"
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
          <Card key="personal" className="animate-in slide-in-from-right-4 fade-in duration-300">
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
                    name="age"
                    type="number"
                    placeholder="Your age"
                    value={formValues.age}
                    onChange={(e) => updateField("age", e.target.value)}
                    disabled={!questionnaireOpen}
                    required
                  />
                  {actionData?.fieldErrors?.age && (
                    <p className="text-sm text-destructive">
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
                    <SelectTrigger id="gender">
                      <SelectValue placeholder="Select gender" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Male">Male</SelectItem>
                      <SelectItem value="Female">Female</SelectItem>
                      <SelectItem value="Other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  {actionData?.fieldErrors?.gender && (
                    <p className="text-sm text-destructive">
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
                    <SelectTrigger id="education">
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
                    <p className="text-sm text-destructive">
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
                    <p className="text-sm text-destructive">
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
                    <p className="text-sm text-destructive">
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
          <Card key="skills" className="animate-in slide-in-from-right-4 fade-in duration-300">
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
                  maxLength={5000}
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
                  maxLength={5000}
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
          <Card key="motivation" className="animate-in slide-in-from-right-4 fade-in duration-300">
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
                  maxLength={5000}
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
                  maxLength={5000}
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
                  maxLength={5000}
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
                  maxLength={5000}
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
                  maxLength={5000}
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
                  maxLength={5000}
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
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
