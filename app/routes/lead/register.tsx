import { useState, useEffect, useRef } from "react";
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
import type { TeamStatus, TeamRecord, MemberRecord } from "~/lib/types";
import { canTransition } from "~/lib/types";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Separator } from "~/components/ui/separator";
import { UserPlus, Save, Loader2, AlertCircle, ClipboardList, ChevronDown, ChevronUp } from "lucide-react";
import { toast } from "sonner";
import { StepIndicator, getLeadSteps } from "~/components/shared/step-indicator";
import { useAutoSave } from "~/hooks/use-auto-save";

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
  let members: MemberRecord[] = [];

  if (team) {
    members = await pb
      .collection("members")
      .getFullList<MemberRecord>({
        filter: pb.filter('teamId = {:teamId}', { teamId: team.id }),
      });
  }

  const flags = await getConfig(pb);
  const registrationOpen = flags.registration_open ?? false;

  return {
    user,
    team,
    members,
    registrationOpen,
  } satisfies LoaderData;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  validateOrigin(request);
  const { pb, user } = await requireRole(request, ["lead"]);

  const flags = await getConfig(pb);
  const registrationOpen = flags.registration_open ?? false;
  if (!registrationOpen) {
    return Response.json(
      { error: "Registration is currently closed" },
      { status: 403 },
    );
  }

  const formData = await request.formData();

  const teamName = formData.get("teamName") as string;
  const leadPhone = formData.get("leadPhone") as string;
  const leadGender = formData.get("leadGender") as string;
  const leadRole = formData.get("leadRole") as string;

  // Validate
  const fieldErrors: Record<string, string> = {};
  if (!teamName?.trim()) fieldErrors.teamName = "Team name is required";
  else if (teamName.length > 100) fieldErrors.teamName = "Team name must be under 100 characters";
  if (!leadPhone?.trim()) fieldErrors.leadPhone = "Phone is required";
  else if (leadPhone.length > 20) fieldErrors.leadPhone = "Phone number too long";
  if (!leadGender) fieldErrors.leadGender = "Gender is required";
  if (!leadRole?.trim()) fieldErrors.leadRole = "Role is required";
  else if (leadRole.length > 100) fieldErrors.leadRole = "Role must be under 100 characters";

  // Parse members
  const memberNames = formData.getAll("memberName") as string[];
  const memberEmails = formData.getAll("memberEmail") as string[];
  const memberPhones = formData.getAll("memberPhone") as string[];
  const memberGenders = formData.getAll("memberGender") as string[];
  const memberRoles = formData.getAll("memberRole") as string[];

  if (memberNames.length < 1 || memberNames.length > 5) {
    fieldErrors.members = "Add between 1 and 5 team members";
  }

  for (let i = 0; i < memberNames.length; i++) {
    if (
      !memberNames[i]?.trim() ||
      !memberEmails[i]?.trim() ||
      !memberPhones[i]?.trim() ||
      !memberGenders[i] ||
      !memberRoles[i]?.trim()
    ) {
      fieldErrors[`member-${i}`] = "All member fields are required";
    } else {
      if (memberNames[i].length > 100) fieldErrors[`member-name-${i}`] = "Name must be under 100 characters";
      if (memberEmails[i].length > 200) fieldErrors[`member-email-${i}`] = "Email too long";
      if (memberPhones[i].length > 20) fieldErrors[`member-phone-${i}`] = "Phone number too long";
      if (memberRoles[i].length > 100) fieldErrors[`member-role-${i}`] = "Role must be under 100 characters";
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return Response.json({ fieldErrors }, { status: 400 });
  }

  // Find or create team
  const teams = await pb
    .collection("teams")
    .getFullList<TeamRecord>({
      filter: pb.filter('leaderUserId = {:userId}', { userId: user.id }),
    });

  const existingTeam = teams.length > 0 ? teams[0] : null;
  let teamId: string;

  if (existingTeam) {
    // Validate status transition — don't reset teams past "registered"
    if (!canTransition(existingTeam.status, "registered", "lead")) {
      return Response.json(
        {
          error: `Cannot re-register team in "${existingTeam.status}" status. Contact your institution lead.`,
        },
        { status: 400 },
      );
    }

    // Update existing team
    const updatedTeam = await pb.collection("teams").update(existingTeam.id, {
      name: teamName.slice(0, 100),
      status: "registered",
    });
    teamId = updatedTeam.id;

    // Delete old members and re-create
    const oldMembers = await pb
      .collection("members")
      .getFullList({ filter: pb.filter('teamId = {:teamId}', { teamId }) });
    for (const m of oldMembers) {
      await pb.collection("members").delete(m.id);
    }
  } else {
    // Create team
    const newTeam = await pb.collection("teams").create({
      name: teamName.slice(0, 100),
      institutionId: user.institutionId,
      leaderUserId: user.id,
      status: "registered",
    });
    teamId = newTeam.id;
  }

  // Create leader member record
  await pb.collection("members").create({
    teamId,
    fullName: user.name,
    email: user.email,
    phone: leadPhone,
    gender: leadGender,
    role: leadRole,
  });

  // Create other members
  for (let i = 0; i < memberNames.length; i++) {
    await pb.collection("members").create({
      teamId,
      fullName: memberNames[i].trim().slice(0, 100),
      email: memberEmails[i].trim().toLowerCase().slice(0, 200),
      phone: memberPhones[i].trim().slice(0, 20),
      gender: memberGenders[i],
      role: memberRoles[i].trim().slice(0, 100),
    });
  }

  return Response.json({ success: true });
}

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
  const { user, team, members, registrationOpen } =
    useLoaderData() as LoaderData;
  const actionData = useActionData() as ActionData | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  // Autosave — periodically persist form state, restore drafts on mount
  const { savedData, save, clearSaved } = useAutoSave<RegisterFormData>(
    `register-form-${user.id}`,
    3000,
    true, // clearOnUnmount — PII should not persist after closing
  );

  const [teamName, setTeamName] = useState(team?.name ?? savedData?.teamName ?? "");
  const [leadPhone, setLeadPhone] = useState(
    members.find((m) => m.email === user.email)?.phone ?? savedData?.leadPhone ?? "",
  );
  const [leadGender, setLeadGender] = useState(
    members.find((m) => m.email === user.email)?.gender ?? savedData?.leadGender ?? "",
  );
  const [leadRole, setLeadRole] = useState(
    members.find((m) => m.email === user.email)?.role ?? savedData?.leadRole ?? "",
  );

  // Filter out the lead from members list
  const otherMembers = members.filter(
    (m) => m.email.toLowerCase() !== user.email.toLowerCase(),
  );

  const [memberFields, setMemberFields] = useState<
    Array<{
      fullName: string;
      email: string;
      phone: string;
      gender: string;
      role: string;
    }>
  >(
    otherMembers.length > 0
      ? otherMembers.map((m) => ({
          fullName: m.fullName,
          email: m.email,
          phone: m.phone,
          gender: m.gender,
          role: m.role,
        }))
      : [{ fullName: "", email: "", phone: "", gender: "", role: "" }],
  );

  const isApproved =
    team?.status === "shortlisted" ||
    team?.status === "submitted" ||
    team?.status === "selected";

  const steps = getLeadSteps(team?.status ?? null, "/lead/register");
  const [showReview, setShowReview] = useState(false);

  // Save on every field change
  useEffect(() => {
    save({
      teamName,
      leadPhone,
      leadGender,
      leadRole,
      members: memberFields,
    });
  }, [teamName, leadPhone, leadGender, leadRole, memberFields, save]);

  // Clear autosave on successful submit
  useEffect(() => {
    if (actionData?.success) {
      clearSaved();
      toast.success(team ? "Team updated!" : "Team registered!");
    }
  }, [actionData?.success, clearSaved, team]);

  // Show error toast
  const prevError = useRef(actionData?.error);
  useEffect(() => {
    if (actionData?.error && actionData.error !== prevError.current) {
      toast.error(actionData.error);
    }
    prevError.current = actionData?.error;
  }, [actionData?.error]);

  const addMember = () => {
    if (memberFields.length < 5) {
      setMemberFields([
        ...memberFields,
        { fullName: "", email: "", phone: "", gender: "", role: "" },
      ]);
    }
  };

  const removeMember = (index: number) => {
    if (memberFields.length > 1) {
      setMemberFields(memberFields.filter((_, i) => i !== index));
    }
  };

  const updateMember = (
    index: number,
    field: string,
    value: string,
  ) => {
    setMemberFields((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
    );
  };

  if (isApproved) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Team Registration
          </h1>
          <p className="text-muted-foreground">
            Your team has been locked for changes.
          </p>
        </div>
        <Card>
          <CardContent className="py-8">
            <div className="flex flex-col items-center justify-center text-center">
              <AlertCircle className="mb-3 h-12 w-12 text-emerald-600 opacity-50" />
              <p className="mb-1 font-medium text-emerald-700">
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
    <div className="space-y-8">
      <StepIndicator steps={steps} />

      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {team ? "Update Team Registration" : "Register Team"}
        </h1>
        <p className="text-muted-foreground">
          {team
            ? "Update your team details for VisionHack 2026"
            : "Register your team for VisionHack 2026"}
        </p>
      </div>

      {!registrationOpen && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          Registration is currently closed. You can view your details but
          cannot make changes.
        </div>
      )}

      {actionData?.success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Team {team ? "updated" : "registered"} successfully!
        </div>
      )}

      {actionData?.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
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
                name="teamName"
                placeholder="Enter your team name"
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                disabled={!registrationOpen}
                required
              />
              {actionData?.fieldErrors?.teamName && (
                <p className="text-sm text-destructive">
                  {actionData.fieldErrors.teamName}
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
                  name="leadPhone"
                  placeholder="+91 1234567890"
                  aria-describedby="leadPhone-hint"
                  value={leadPhone}
                  onChange={(e) => setLeadPhone(e.target.value)}
                  disabled={!registrationOpen}
                  required
                />
                <p id="leadPhone-hint" className="text-xs text-muted-foreground">
                  Enter your 10-digit phone number with country code
                </p>
                {actionData?.fieldErrors?.leadPhone && (
                  <p className="text-sm text-destructive">
                    {actionData.fieldErrors.leadPhone}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="leadGender">Gender</Label>
                <Select
                  value={leadGender}
                  onValueChange={setLeadGender}
                  disabled={!registrationOpen}
                  name="leadGender"
                >
                  <SelectTrigger id="leadGender">
                    <SelectValue placeholder="Select gender" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Male">Male</SelectItem>
                    <SelectItem value="Female">Female</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
                {actionData?.fieldErrors?.leadGender && (
                  <p className="text-sm text-destructive">
                    {actionData.fieldErrors.leadGender}
                  </p>
                )}
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="leadRole">Role</Label>
                <Input
                  id="leadRole"
                  name="leadRole"
                  placeholder="e.g., Team Lead, Full Stack Developer"
                  value={leadRole}
                  onChange={(e) => setLeadRole(e.target.value)}
                  disabled={!registrationOpen}
                  required
                />
                {actionData?.fieldErrors?.leadRole && (
                  <p className="text-sm text-destructive">
                    {actionData.fieldErrors.leadRole}
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
                Team Members ({memberFields.length})
              </CardTitle>
              {memberFields.length < 5 && registrationOpen && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addMember}
                >
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
              <p className="text-sm text-destructive">
                {actionData.fieldErrors.members}
              </p>
            )}

            {memberFields.map((member, index) => (
              <fieldset key={index}>
                <legend className="text-sm font-semibold text-foreground w-full">
                  Member {index + 1}
                </legend>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    {memberFields.length > 1 && registrationOpen && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMember(index)}
                        className="text-destructive hover:bg-destructive/10"
                      >
                        Remove
                      </Button>
                    )}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor={`member-name-${index}`}>
                        Full Name
                      </Label>
                      <Input
                        id={`member-name-${index}`}
                        name="memberName"
                        placeholder="Full name"
                        value={member.fullName}
                        onChange={(e) =>
                          updateMember(index, "fullName", e.target.value)
                        }
                        disabled={!registrationOpen}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`member-email-${index}`}>
                        Email
                      </Label>
                      <Input
                        id={`member-email-${index}`}
                        name="memberEmail"
                        type="email"
                        placeholder="email@example.com"
                        value={member.email}
                        onChange={(e) =>
                          updateMember(index, "email", e.target.value)
                        }
                        disabled={!registrationOpen}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`member-phone-${index}`}>
                        Phone
                      </Label>
                      <Input
                        id={`member-phone-${index}`}
                        name="memberPhone"
                        placeholder="+91 1234567890"
                        value={member.phone}
                        onChange={(e) =>
                          updateMember(index, "phone", e.target.value)
                        }
                        disabled={!registrationOpen}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`member-gender-${index}`}>
                        Gender
                      </Label>
                      <Select
                        value={member.gender}
                        onValueChange={(value) =>
                          updateMember(index, "gender", value)
                        }
                        disabled={!registrationOpen}
                        name="memberGender"
                      >
                        <SelectTrigger
                          id={`member-gender-${index}`}
                        >
                          <SelectValue placeholder="Select gender" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Male">Male</SelectItem>
                          <SelectItem value="Female">Female</SelectItem>
                          <SelectItem value="Other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor={`member-role-${index}`}>
                        Role
                      </Label>
                      <Input
                        id={`member-role-${index}`}
                        name="memberRole"
                        placeholder="e.g., Developer, Designer, Manager"
                        value={member.role}
                        onChange={(e) =>
                          updateMember(index, "role", e.target.value)
                        }
                        disabled={!registrationOpen}
                        required
                      />
                    </div>
                  </div>
                </div>
                {index < memberFields.length - 1 && (
                  <Separator className="mt-6" />
                )}
              </fieldset>
            ))}
          </CardContent>
        </Card>

        {/* Review Summary */}
        <Card
          className={`border-dashed transition-colors ${
            showReview ? "border-primary/40" : "border-border"
          }`}
        >
          <button
            type="button"
            className="flex w-full items-center justify-between p-4 text-left"
            onClick={() => setShowReview(!showReview)}
          >
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">
                Review your details before submitting
              </span>
            </div>
            {showReview ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </button>
          {showReview && (
            <div className="border-t px-4 pb-4">
              <div className="mt-3 space-y-3 text-sm">
                <div>
                  <p className="font-medium text-muted-foreground">Team Name</p>
                  <p>{teamName || "(not set)"}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="font-medium text-muted-foreground">Lead Phone</p>
                    <p>{leadPhone || "(not set)"}</p>
                  </div>
                  <div>
                    <p className="font-medium text-muted-foreground">Lead Gender</p>
                    <p>{leadGender || "(not set)"}</p>
                  </div>
                  <div>
                    <p className="font-medium text-muted-foreground">Lead Role</p>
                    <p>{leadRole || "(not set)"}</p>
                  </div>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">
                    Members ({memberFields.length})
                  </p>
                  {memberFields.length === 0 ? (
                    <p className="text-muted-foreground italic">No members added</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {memberFields.map((m, i) => (
                        <li key={i} className="flex items-center gap-1 text-muted-foreground">
                          <span className="font-medium text-foreground">{m.fullName || `Member ${i + 1}`}</span>
                          {m.email && <span>— {m.email}</span>}
                          {m.role && <span>({m.role})</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Submit */}
        {registrationOpen && (
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
