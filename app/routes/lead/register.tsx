import { useState, useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { registerSchema } from "~/lib/schemas/register";
import {
  useLoaderData,
  Form,
  useNavigation,
  useActionData,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { secureAction, fail, ok } from "~/lib/action.server";
import { getConfig } from "~/lib/config.server";
import { getLeadTeam } from "~/lib/team.server";
import { getStr, getAllStr, isEmail } from "~/lib/form.server";
import type { TeamRecord, MemberRecord } from "~/lib/types";
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
import { UserPlus, Save, Loader2, AlertCircle } from "lucide-react";
import { StepIndicator, getLeadSteps } from "~/components/shared/step-indicator";
import { PanelHeader } from "~/components/shared/panel-header";
import { useAutoSave } from "~/hooks/use-auto-save";
import { useActionToast } from "~/hooks/use-action-toast";
import { ReviewSummary } from "~/components/shared/review-summary";

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

  // Team and config are independent — fetch in parallel.
  const [team, flags] = await Promise.all([
    getLeadTeam<TeamRecord>(pb, user.id),
    getConfig(pb),
  ]);

  const MAX_SAFE_LIST = 500;
  const members: MemberRecord[] = team
    ? (
        await pb.collection("members").getList<MemberRecord>(1, MAX_SAFE_LIST, {
          filter: pb.filter("teamId = {:teamId}", { teamId: team.id }),
        })
      ).items
    : [];

  return {
    user,
    team,
    members,
    registrationOpen: flags.registration_open ?? false,
  } satisfies LoaderData;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = secureAction({ roles: ["lead"] }, async ({ formData, user, pb }) => {
  const flags = await getConfig(pb);
  if (!flags.registration_open) {
    return fail({ error: "Registration is currently closed", status: 403 });
  }

  const teamName = getStr(formData, "teamName");
  const leadPhone = getStr(formData, "leadPhone");
  const leadGender = getStr(formData, "leadGender", { trim: false });
  const leadRole = getStr(formData, "leadRole");

  // Validate
  const fieldErrors: Record<string, string> = {};
  if (!teamName) fieldErrors.teamName = "Team name is required";
  else if (teamName.length > 100) fieldErrors.teamName = "Team name must be under 100 characters";
  if (!leadPhone) fieldErrors.leadPhone = "Phone is required";
  else if (leadPhone.length > 20) fieldErrors.leadPhone = "Phone number too long";
  if (!leadGender) fieldErrors.leadGender = "Gender is required";
  if (!leadRole) fieldErrors.leadRole = "Role is required";
  else if (leadRole.length > 100) fieldErrors.leadRole = "Role must be under 100 characters";

  // Parse members
  const memberNames = getAllStr(formData, "memberName");
  const memberEmails = getAllStr(formData, "memberEmail");
  const memberPhones = getAllStr(formData, "memberPhone");
  const memberGenders = getAllStr(formData, "memberGender");
  const memberRoles = getAllStr(formData, "memberRole");

  if (memberNames.length < 1 || memberNames.length > 5) {
    fieldErrors.members = "Add between 1 and 5 team members";
  }

  for (let i = 0; i < memberNames.length; i++) {
    const name = (memberNames[i] ?? "").trim();
    const email = (memberEmails[i] ?? "").trim();
    const phone = (memberPhones[i] ?? "").trim();
    const gender = memberGenders[i] ?? "";
    const role = (memberRoles[i] ?? "").trim();
    if (!name || !email || !phone || !gender || !role) {
      // Surfaced under the single `members` key the UI renders.
      fieldErrors.members = `Member ${i + 1}: all fields are required`;
    } else if (
      name.length > 100 ||
      email.length > 200 ||
      phone.length > 20 ||
      role.length > 100
    ) {
      fieldErrors.members = `Member ${i + 1}: one or more fields are too long`;
    } else if (!isEmail(email)) {
      fieldErrors.members = `Member ${i + 1}: invalid email format`;
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    return fail({ fieldErrors });
  }

  // Find or create team
  const existingTeam = await getLeadTeam<TeamRecord>(pb, user.id, {
    fields: "id,status",
  });
  let teamId: string;

  if (existingTeam) {
    if (!canTransition(existingTeam.status, "registered", "lead")) {
      return fail({
        error: `Cannot re-register team in "${existingTeam.status}" status. Contact your institution lead.`,
      });
    }

    const updated = await pb.collection("teams").update(existingTeam.id, {
      name: teamName.slice(0, 100),
      status: "registered",
      status_changed_at: new Date().toISOString(),
    });
    teamId = updated.id;

  } else {
    const newTeam = await pb.collection("teams").create({
      name: teamName.slice(0, 100),
      institutionId: user.institutionId,
      leaderUserId: user.id,
      status: "registered",
      status_changed_at: new Date().toISOString(),
    });
    teamId = newTeam.id;
  }

  // Create leader member record + others (parallel, bounded). Drop any
  // member row whose email matches the lead's — the lead is always added
  // explicitly, so this prevents a duplicate leader record.
  const leadEmailLower = user.email.toLowerCase();
  const memberPayloads: Array<Record<string, unknown>> = [
    {
      teamId,
      fullName: user.name,
      email: user.email,
      phone: leadPhone,
      gender: leadGender,
      role: leadRole,
    },
    ...memberNames
      .map((rawName, i) => ({
        teamId,
        fullName: rawName.trim().slice(0, 100),
        email: (memberEmails[i] ?? "").trim().toLowerCase().slice(0, 200),
        phone: (memberPhones[i] ?? "").trim().slice(0, 20),
        gender: memberGenders[i] ?? "",
        role: (memberRoles[i] ?? "").trim().slice(0, 100),
      }))
      .filter((m) => m.email !== leadEmailLower),
  ];
  // Delete OLD members first, then create new ones.
  // Creating-then-deleting caused a bug where all members (old + new) were deleted.
  if (existingTeam) {
    const oldMembers = await pb.collection("members").getFullList({
      filter: pb.filter("teamId = {:teamId}", { teamId }),
      fields: "id",
    });
    await Promise.all(
      oldMembers.map((m) => pb.collection("members").delete(m.id)),
    );
  }

  const creates = await Promise.all(
    memberPayloads.map((payload) => pb.collection("members").create(payload)),
  );

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
  const { user, team, members, registrationOpen } =
    useLoaderData() as LoaderData;
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
  const otherMembers = members.filter(
    (m) => m.email.toLowerCase() !== user.email.toLowerCase(),
  );

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
      memberName: otherMembers.length > 0
        ? otherMembers.map((m) => m.fullName)
        : [""],
      memberEmail: otherMembers.length > 0
        ? otherMembers.map((m) => m.email)
        : [""],
      memberPhone: otherMembers.length > 0
        ? otherMembers.map((m) => m.phone)
        : [""],
      memberGender: otherMembers.length > 0
        ? otherMembers.map((m) => m.gender)
        : [""],
      memberRole: otherMembers.length > 0
        ? otherMembers.map((m) => m.role)
        : [""],
    },
  });

  const memberCount = watch("memberName")?.length ?? 0;

  const isApproved =
    team?.status === "shortlisted" ||
    team?.status === "submitted" ||
    team?.status === "selected";

  const steps = getLeadSteps(team?.status ?? null, "/lead/register");
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
          Registration is currently closed. You can view your details but
          cannot make changes.
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
                aria-describedby={errors.teamName || actionData?.fieldErrors?.teamName ? "teamName-error" : undefined}
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
                  aria-describedby={errors.leadPhone || actionData?.fieldErrors?.leadPhone ? "leadPhone-hint leadPhone-error" : "leadPhone-hint"}
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
                      <SelectTrigger id="leadGender" aria-invalid={!!(errors.leadGender || actionData?.fieldErrors?.leadGender)} aria-describedby={errors.leadGender || actionData?.fieldErrors?.leadGender ? "leadGender-error" : undefined}>
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
                  aria-describedby={errors.leadRole || actionData?.fieldErrors?.leadRole ? "leadRole-error" : undefined}
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
              <p id="members-error" className="text-sm text-destructive" role="alert">
                {actionData.fieldErrors.members}
              </p>
            )}
            {errors.memberName?.root?.message && (
              <p className="text-sm text-destructive" role="alert">
                {errors.memberName.root.message}
              </p>
            )}

            {Array.from({ length: memberCount }, (_, index) => (
              <fieldset
                key={index}
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
                    <Label htmlFor={`member-name-${index}`}>
                      Full Name
                    </Label>
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
                    <Label htmlFor={`member-email-${index}`}>
                      Email
                    </Label>
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
                    <Label htmlFor={`member-phone-${index}`}>
                      Phone
                    </Label>
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
                    <Label htmlFor={`member-gender-${index}`}>
                      Gender
                    </Label>
                    <Controller
                      control={control}
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
                    <Label htmlFor={`member-role-${index}`}>
                      Role
                    </Label>
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
            ))}
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
            <p className="font-medium text-muted-foreground">
              Members ({memberCount})
            </p>
            {memberCount === 0 ? (
              <p className="text-muted-foreground italic">No members added</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {Array.from({ length: memberCount }, (_, i) => {
                  const name = getValues(`memberName.${i}` as any);
                  const email = getValues(`memberEmail.${i}` as any);
                  const role = getValues(`memberRole.${i}` as any);
                  return (
                    <li key={i} className="flex items-center gap-1 text-muted-foreground">
                      <span className="font-medium text-foreground">{name || `Member ${i + 1}`}</span>
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
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={isSubmitting}
          >
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
        <button onClick={() => window.location.reload()} className="inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity">Try again</button>
      </div>
    </div>
  );
}
