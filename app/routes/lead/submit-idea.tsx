import { useState, useContext } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { submitIdeaSchema } from "~/lib/schemas/submit-idea";
import {
  useLoaderData,
  Form,
  useNavigation,
  useActionData,
  useRouteError,
  isRouteErrorResponse,
} from "react-router";
import { CsrfContext } from "~/routes/dashboard-layout";
import type { LoaderFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { secureAction, fail, ok } from "~/lib/action.server";
import { getConfig } from "~/lib/config.server";
import { getLeadTeam } from "~/lib/team.server";
import { getStr } from "~/lib/form.server";
import { canTransition } from "~/lib/types";
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
  AlertCircle,
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { StepIndicator, getLeadSteps } from "~/components/shared/step-indicator";
import { PanelHeader } from "~/components/shared/panel-header";
import { ReviewSummary } from "~/components/shared/review-summary";
import { useActionToast } from "~/hooks/use-action-toast";
import { MAX_FILE_SIZE, ALLOWED_MIME_TYPES } from "~/lib/constants";

// Magic bytes for file type verification (first bytes of the file)
// Prevents renamed .exe files from being uploaded as PDF/PPT
const MAGIC_BYTES: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  // Accept both old OLE2 PPT and modern ZIP-based PPTX (which has ZIP header).
  // The ZIP check alone is not unique to PPTX (also matches .docx, .xlsx, .zip),
  // but combined with the MIME type and file extension check above this is
  // sufficient to prevent renamed .exe files.
  ppt: [
    [0xD0, 0xCF, 0x11, 0xE0], // OLE2 (PPT)
    [0x50, 0x4B, 0x03, 0x04], // ZIP/OpenXML (PPTX)
  ],
};
/**
 * Verify a file's magic bytes match the expected type.
 * Returns true if the file passes validation.
 */
async function validateFileSignature(file: File): Promise<boolean> {
  // Read 16 bytes for magic byte checking — sufficient for PDF (%PDF) and
  // OLE2 PPT (D0CF11E0). ZIP header (PK\x03\x04) is at offset 0-3, also
  // covered by 16 bytes. Insufficient for deep MIME validation, but good
  // enough to reject renamed .exe files.
  const buffer = await file.slice(0, 16).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Check PDF magic bytes
  if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
    return MAGIC_BYTES.pdf.some((sig) =>
      sig.every((b, i) => bytes[i] === b),
    );
  }

  // Check PPT/PPTX magic bytes (OLE2 or ZIP/OpenXML format)
  if (
    file.type.includes("presentation") ||
    file.name.endsWith(".ppt") ||
    file.name.endsWith(".pptx")
  ) {
    return MAGIC_BYTES.ppt.some((sig) =>
      sig.every((b, i) => bytes[i] === b),
    );
  }

  return false;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LoaderData {
  user: { id: string; name: string; email: string };
  team: TeamRecord | null;
  submissionOpen: boolean;
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

  return {
    user,
    team,
    submissionOpen: flags.submission_open ?? false,
  } satisfies LoaderData;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = secureAction({ roles: ["lead"] }, async ({ formData, user, pb }) => {
  const flags = await getConfig(pb);
  if (!flags.submission_open) {
    return fail({ error: "Submissions are currently closed", status: 403 });
  }

  const ideaTitle = getStr(formData, "ideaTitle");
  const ideaDescription = getStr(formData, "ideaDescription");
  const techStack = getStr(formData, "techStack");
  const file = formData.get("file") as File | null;

  // Validate text
  const fieldErrors: Record<string, string> = {};
  if (!ideaTitle) fieldErrors.ideaTitle = "Idea title is required";
  else if (ideaTitle.length > 200) fieldErrors.ideaTitle = "Idea title must be under 200 characters";
  if (!ideaDescription) fieldErrors.ideaDescription = "Idea description is required";
  else if (ideaDescription.length > 5000) fieldErrors.ideaDescription = "Idea description must be under 5000 characters";
  if (!techStack) fieldErrors.techStack = "Tech stack is required";
  else if (techStack.length > 500) fieldErrors.techStack = "Tech stack must be under 500 characters";

  if (Object.keys(fieldErrors).length > 0) {
    return fail({ fieldErrors });
  }

  // Find team
  const team = await getLeadTeam<TeamRecord>(pb, user.id, {
    fields: "id,status,submission_file",
  });
  if (!team) return fail({ error: "Team not found", status: 404 });

  // Validate status transition
  if (!canTransition(team.status, "submitted", "lead")) {
    return fail({ error: "Your team must be shortlisted before submitting an idea", status: 403 });
  }

  // File present
  if (file && file.size > 0) {
    if (file.size > MAX_FILE_SIZE) {
      return fail({ fieldErrors: { file: "File must be less than 10 MB" } });
    }
    if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
      return fail({ fieldErrors: { file: "Only PDF and PPT files are allowed" } });
    }
    if (!(await validateFileSignature(file))) {
      return fail({
        fieldErrors: {
          file: "File does not appear to be a valid PDF or PPT. Only genuine PDF/PPT files are accepted.",
        },
      });
    }

    // PB needs a multipart form to upload a file
    const form = new FormData();
    const safeName = file.name.replace(/[^\w.\-]/g, "_").slice(0, 255);
    form.append("submission_file", file, safeName);
    form.append("idea_title", ideaTitle.slice(0, 200));
    form.append("idea_desc", ideaDescription.slice(0, 5000));
    form.append("idea_tech_stack", techStack.slice(0, 500));
    form.append("status", "submitted");
    form.append("status_changed_at", new Date().toISOString());
    await pb.collection("teams").update(team.id, form, {
      filter: pb.filter("status = {:expected}", { expected: team.status }),
      $autoCancel: false,
    });
    return ok();
  }

  // No new file — re-submit text only if the file already exists
  if (team.submission_file) {
    await pb.collection("teams").update(team.id, {
      idea_title: ideaTitle.slice(0, 200),
      idea_desc: ideaDescription.slice(0, 5000),
      idea_tech_stack: techStack.slice(0, 500),
      status: "submitted",
      status_changed_at: new Date().toISOString(),
    }, {
      filter: pb.filter("status = {:expected}", { expected: team.status }),
      $autoCancel: false,
    });
    return ok();
  }

  return fail({ fieldErrors: { file: "Please upload a presentation file" } });
});

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

export function meta() {
  return [{ title: "Step 3 of 3: Submit Idea — VisionHack" }];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function LeadSubmitIdea() {
  const { team, submissionOpen } =
    useLoaderData() as LoaderData;
  const actionData = useActionData() as ActionData | undefined;
  const {
    register,
    formState: { errors },
    getValues,
  } = useForm({
    resolver: zodResolver(submitIdeaSchema),
    defaultValues: {
      ideaTitle: team?.idea_title ?? "",
      ideaDescription: team?.idea_desc ?? "",
      techStack: team?.idea_tech_stack ?? "",
    },
  });
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const csrfToken = useContext(CsrfContext);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);

  const existingSubmission = !!team?.idea_title;
  const isShortlisted = team?.status === "shortlisted";
  const isAlreadySubmitted =
    team?.status === "submitted" ||
    team?.status === "selected" ||
    team?.status === "rejected";

  const steps = getLeadSteps(team?.status ?? null, "/lead/submit-idea");

  // Toasts for action feedback.
  useActionToast(actionData, {
    success: () => (existingSubmission ? "Idea updated!" : "Idea submitted!"),
  });

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setFileError(null);
    if (file) {
      // Client-side validation
      if (file.size > MAX_FILE_SIZE) {
        setFileError("File must be less than 10 MB");
        e.target.value = "";
        return;
      }
      if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(file.type)) {
        setFileError("Only PDF and PPT files are allowed");
        e.target.value = "";
        return;
      }
      setSelectedFile(file);
    }
  };

  // Not shortlisted — can't submit
  if (team && !isShortlisted && !isAlreadySubmitted) {
    return (
      <div className="space-y-10">
        <StepIndicator steps={steps} />

        <PanelHeader
          eyebrow="Step 03"
          title="Submit idea"
          description="Upload your idea presentation"
        />
        <Card>
          <CardContent className="py-8 text-center">
            <AlertCircle className="mx-auto mb-3 h-12 w-12 text-muted-foreground opacity-30" />
            <p className="font-medium">
              Shortlisting required
            </p>
            <p className="text-sm text-muted-foreground">
              Your team needs to be shortlisted by your institution before you
              can submit an idea.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Already submitted
  if (isAlreadySubmitted) {
    return (
      <div className="space-y-10">
        <StepIndicator steps={steps} />

        <PanelHeader
          eyebrow="Step 03"
          title="Submit idea"
          description="Your idea has been submitted"
        />
        <Card>
          <CardContent className="py-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-success opacity-60" />
            <p className="mb-1 font-medium text-success">
              {team.status === "selected"
                ? "Congratulations — your idea has been selected!"
                : "Your idea has been submitted successfully!"}
            </p>
            {team.idea_title && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Title:</span>{" "}
                {team.idea_title}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <StepIndicator steps={steps} />

      <PanelHeader
        eyebrow="Step 03"
        title={existingSubmission ? "Update your idea" : "Submit your idea"}
        description="Share your innovation with us. Upload your presentation and details."
      />

      {!submissionOpen && (
        <div className="rounded-md border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-warning">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          Submissions are currently closed. You can view your details but
          cannot make changes.
        </div>
      )}

      {actionData?.success && (
        <div className="rounded-md border border-success/30 bg-success/8 px-4 py-3 text-sm text-success">
          Idea submitted successfully!
        </div>
      )}

      {actionData?.error && (
        <div className="rounded-md border border-danger/30 bg-danger/8 px-4 py-3 text-sm text-danger">
          {actionData.error}
        </div>
      )}

      {submissionOpen && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Project Details
            </CardTitle>
            <CardDescription>
              Fill in the details of your project.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" encType="multipart/form-data" className="space-y-6">
            <input type="hidden" name="csrf_token" value={csrfToken} />
              <div className="space-y-2">
                <Label htmlFor="ideaTitle">
                  Idea Title{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ideaTitle"
                  aria-invalid={!!(errors.ideaTitle || actionData?.fieldErrors?.ideaTitle)}
                  aria-describedby={errors.ideaTitle || actionData?.fieldErrors?.ideaTitle ? "ideaTitle-error" : undefined}
                  maxLength={200}
                  placeholder="Enter project title"
                  {...register("ideaTitle")}
                  disabled={!submissionOpen}
                  required
                />
                {(errors.ideaTitle || actionData?.fieldErrors?.ideaTitle) && (
                  <p id="ideaTitle-error" className="text-sm text-destructive" role="alert">
                    {errors.ideaTitle?.message ?? actionData?.fieldErrors?.ideaTitle}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="ideaDescription">
                  Description{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  id="ideaDescription"
                  aria-invalid={!!(errors.ideaDescription || actionData?.fieldErrors?.ideaDescription)}
                  aria-describedby={errors.ideaDescription || actionData?.fieldErrors?.ideaDescription ? "ideaDescription-error" : undefined}
                  maxLength={5000}
                  placeholder="Describe your idea briefly..."
                  className="min-h-[120px]"
                  {...register("ideaDescription")}
                  disabled={!submissionOpen}
                  required
                />
                {(errors.ideaDescription || actionData?.fieldErrors?.ideaDescription) && (
                  <p id="ideaDescription-error" className="text-sm text-destructive" role="alert">
                    {errors.ideaDescription?.message ?? actionData?.fieldErrors?.ideaDescription}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="techStack">
                  Tech Stack{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="techStack"
                  aria-invalid={!!(errors.techStack || actionData?.fieldErrors?.techStack)}
                  aria-describedby={errors.techStack || actionData?.fieldErrors?.techStack ? "techStack-error" : undefined}
                  maxLength={500}
                  placeholder="e.g. Next.js, Python, Flutter"
                  {...register("techStack")}
                  disabled={!submissionOpen}
                  required
                />
                {(errors.techStack || actionData?.fieldErrors?.techStack) && (
                  <p id="techStack-error" className="text-sm text-destructive" role="alert">
                    {errors.techStack?.message ?? actionData?.fieldErrors?.techStack}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="file">
                  Presentation (PDF/PPT)
                </Label>
                <div className="relative rounded-lg border-2 border-dashed border-border p-6 transition-colors hover:bg-muted/50">
                  <Input
                    id="file"
                    aria-invalid={!!(fileError || actionData?.fieldErrors?.file)}
                    name="file"
                    type="file"
                    accept=".pdf,.ppt,.pptx"
                    aria-describedby={(fileError || actionData?.fieldErrors?.file) ? "file-hint file-error" : "file-hint"}
                    onChange={handleFileChange}
                    className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                    disabled={!submissionOpen}
                  />
                  <div className="flex flex-col items-center justify-center">
                    <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                    <p className="text-sm font-medium text-foreground">
                      {selectedFile
                        ? selectedFile.name
                        : team?.submission_file
                          ? "Current file: Click to replace"
                          : "Click to upload or drag and drop"}
                    </p>
                    <p id="file-hint" className="mt-1 text-xs text-muted-foreground">
                      PDF, PPT, or PPTX (Max 10 MB)
                    </p>
                  </div>
                </div>
                {fileError && (
                  <p id="file-error" className="text-sm text-destructive mt-2" role="alert">
                    {fileError}
                  </p>
                )}
                {actionData?.fieldErrors?.file && (
                  <p id="file-error" className="text-sm text-destructive" role="alert">
                    {actionData.fieldErrors.file}
                  </p>
                )}
              </div>

              {/* Review Summary */}
              <ReviewSummary
                open={showReview}
                onToggle={setShowReview}
                label="Review your submission before sending"
              >
                <div>
                  <p className="font-medium text-muted-foreground">Idea Title</p>
                  <p>{getValues("ideaTitle") || "(not set)"}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Tech Stack</p>
                  <p>{getValues("techStack") || "(not set)"}</p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">Description</p>
                  <p className="line-clamp-4 text-muted-foreground">
                    {getValues("ideaDescription") || "(not set)"}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-muted-foreground">File</p>
                  <p>{selectedFile?.name ?? team?.submission_file ?? "(no file selected)"}</p>
                </div>
              </ReviewSummary>

              {submissionOpen && (
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 vh-spin" />
                  ) : (
                    <Upload className="mr-2 h-4 w-4" />
                  )}
                  {isSubmitting
                    ? "Submitting..."
                    : existingSubmission
                      ? "Update Submission"
                      : "Submit Idea"}
                </Button>
              )}
            </Form>
          </CardContent>
        </Card>
      )}
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
