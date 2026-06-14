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
import { isOpen } from "~/lib/config.server";
import { canTransition } from "~/lib/types";
import type { TeamStatus, Role, TeamRecord } from "~/lib/types";
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
  ClipboardList,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { toast } from "sonner";
import { StepIndicator, getLeadSteps } from "~/components/shared/step-indicator";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];

// Magic bytes for file type verification (first bytes of the file)
// Prevents renamed .exe files from being uploaded as PDF/PPT
const MAGIC_BYTES: Record<string, number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
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
  const buffer = await file.slice(0, 8).arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // Check PDF magic bytes
  if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
    return MAGIC_BYTES.pdf.some((sig) =>
      sig.every((b, i) => bytes[i] === b),
    );
  }

  // Check PPT/PPTX magic bytes
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

  const teams = await pb
    .collection("teams")
    .getFullList<TeamRecord>({
      filter: pb.filter('leaderUserId = {:userId}', { userId: user.id }),
    });

  const team = teams.length > 0 ? teams[0] : null;
  const submissionOpen = await isOpen(pb, "submission_open");

  return {
    user,
    team,
    submissionOpen,
  } satisfies LoaderData;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  validateOrigin(request);
  const { pb, user } = await requireRole(request, ["lead"]);

  const submissionOpen = await isOpen(pb, "submission_open");
  if (!submissionOpen) {
    return Response.json(
      { error: "Submissions are currently closed" },
      { status: 403 },
    );
  }

  const formData = await request.formData();

  const ideaTitle = formData.get("ideaTitle") as string;
  const ideaDescription = formData.get("ideaDescription") as string;
  const techStack = formData.get("techStack") as string;
  const file = formData.get("file") as File | null;

  // Validate
  const fieldErrors: Record<string, string> = {};
  if (!ideaTitle?.trim()) fieldErrors.ideaTitle = "Idea title is required";
  else if (ideaTitle.length > 200) fieldErrors.ideaTitle = "Idea title must be under 200 characters";
  if (!ideaDescription?.trim())
    fieldErrors.ideaDescription = "Idea description is required";
  else if (ideaDescription.length > 5000) fieldErrors.ideaDescription = "Idea description must be under 5000 characters";
  if (!techStack?.trim())
    fieldErrors.techStack = "Tech stack is required";
  else if (techStack.length > 500) fieldErrors.techStack = "Tech stack must be under 500 characters";

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

  // Validate status transition
  if (
    !canTransition(
      team.status as TeamStatus,
      "submitted",
      "lead" as Role,
    )
  ) {
    return Response.json(
      {
        error:
          "Your team must be shortlisted before submitting an idea",
      },
      { status: 403 },
    );
  }

  if (file && file.size > 0) {
    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      fieldErrors.file = "File must be less than 10 MB";
    }

    // Check file type (MIME)
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      fieldErrors.file = "Only PDF and PPT files are allowed";
    }

    // Check magic bytes (prevents renamed executables)
    if (!fieldErrors.file) {
      const validSig = await validateFileSignature(file);
      if (!validSig) {
        fieldErrors.file =
          "File does not appear to be a valid PDF or PPT. Only genuine PDF/PPT files are accepted.";
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      return Response.json({ fieldErrors }, { status: 400 });
    }

    try {
      const form = new FormData();
      form.append("submission_file", file, file.name);
      form.append("idea_title", ideaTitle.trim().slice(0, 200));
      form.append("idea_desc", ideaDescription.trim().slice(0, 5000));
      form.append("idea_tech_stack", techStack.trim().slice(0, 500));
      form.append("status", "submitted");

      await pb.collection("teams").update(team.id, form);
    } catch (err) {
      console.error("Upload error:", err);
      return Response.json(
        { error: "Failed to upload submission" },
        { status: 500 },
      );
    }
  } else if (team.submission_file) {
    // Text-only update — file already exists from a prior upload
    try {
      await pb.collection("teams").update(team.id, {
        idea_title: ideaTitle.trim().slice(0, 200),
        idea_desc: ideaDescription.trim().slice(0, 5000),
        idea_tech_stack: techStack.trim().slice(0, 500),
        status: "submitted",
      });
    } catch (err) {
      console.error("Update error:", err);
      return Response.json(
        { error: "Failed to update submission" },
        { status: 500 },
      );
    }
  } else {
    fieldErrors.file = "Please upload a presentation file";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return Response.json({ fieldErrors }, { status: 400 });
  }

  return Response.json({ success: true });
}

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
  const { user, team, submissionOpen } =
    useLoaderData() as LoaderData;
  const actionData = useActionData() as ActionData | undefined;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [ideaTitle, setIdeaTitle] = useState(team?.idea_title ?? "");
  const [ideaDescription, setIdeaDescription] = useState(
    team?.idea_desc ?? "",
  );
  const [techStack, setTechStack] = useState(
    team?.idea_tech_stack ?? "",
  );
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

  // Toasts for action feedback
  const prevSuccess = useRef(actionData?.success);
  useEffect(() => {
    if (actionData?.success && !prevSuccess.current) {
      toast.success(existingSubmission ? "Idea updated!" : "Idea submitted!");
    }
    prevSuccess.current = actionData?.success;
  }, [actionData?.success, existingSubmission]);

  const prevError = useRef(actionData?.error);
  useEffect(() => {
    if (actionData?.error && actionData.error !== prevError.current) {
      toast.error(actionData.error);
    }
    prevError.current = actionData?.error;
  }, [actionData?.error]);

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
      if (
        !ALLOWED_MIME_TYPES.includes(file.type)
      ) {
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
      <div className="space-y-6">
        <StepIndicator steps={steps} />

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Submit Idea
          </h1>
          <p className="text-muted-foreground">
            Upload your idea presentation
          </p>
        </div>
        <Card>
          <CardContent className="py-8 text-center">
            <AlertCircle className="mx-auto mb-3 h-12 w-12 text-muted-foreground opacity-30" />
            <p className="font-medium">
              Shortlisting Required
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
      <div className="space-y-6">
        <StepIndicator steps={steps} />

        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Submit Idea
          </h1>
          <p className="text-muted-foreground">
            Your idea has been submitted
          </p>
        </div>
        <Card>
          <CardContent className="py-8 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-emerald-600 opacity-50" />
            <p className="mb-1 font-medium text-emerald-700">
              {team.status === "selected"
                ? "Congratulations! Your idea has been selected!"
                : "Your idea has been submitted successfully!"}
            </p>
            {team.idea_title && (
              <p className="text-sm text-muted-foreground">
                <span className="font-medium">Title:</span>{" "}
                {team.idea_title}
              </p>
            )}
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
          {existingSubmission
            ? "Update Your Idea"
            : "Submit Your Idea"}
        </h1>
        <p className="text-muted-foreground">
          Share your innovation with us. Upload your presentation and
          details.
        </p>
      </div>

      {!submissionOpen && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-800 dark:border-orange-800 dark:bg-orange-950 dark:text-orange-200">
          <AlertCircle className="mr-2 inline h-4 w-4" />
          Submissions are currently closed. You can view your details but
          cannot make changes.
        </div>
      )}

      {actionData?.success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
          Idea submitted successfully!
        </div>
      )}

      {actionData?.error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200">
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
              <div className="space-y-2">
                <Label htmlFor="ideaTitle">
                  Idea Title{" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ideaTitle"
                  name="ideaTitle"
                  value={ideaTitle}
                  onChange={(e) => setIdeaTitle(e.target.value)}
                  maxLength={200}
                  placeholder="Enter project title"
                  disabled={!submissionOpen}
                  required
                />
                {actionData?.fieldErrors?.ideaTitle && (
                  <p className="text-sm text-destructive">
                    {actionData.fieldErrors.ideaTitle}
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
                  name="ideaDescription"
                  value={ideaDescription}
                  onChange={(e) =>
                    setIdeaDescription(e.target.value)
                  }
                  maxLength={5000}
                  placeholder="Describe your idea briefly..."
                  className="min-h-[120px]"
                  disabled={!submissionOpen}
                  required
                />
                {actionData?.fieldErrors?.ideaDescription && (
                  <p className="text-sm text-destructive">
                    {actionData.fieldErrors.ideaDescription}
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
                  name="techStack"
                  value={techStack}
                  onChange={(e) => setTechStack(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. Next.js, Python, Flutter"
                  disabled={!submissionOpen}
                  required
                />
                {actionData?.fieldErrors?.techStack && (
                  <p className="text-sm text-destructive">
                    {actionData.fieldErrors.techStack}
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
                    name="file"
                    type="file"
                    accept=".pdf,.ppt,.pptx"
                    aria-describedby="file-hint"
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
                  <p className="text-sm text-destructive mt-2" role="alert">
                    {fileError}
                  </p>
                )}
                {actionData?.fieldErrors?.file && (
                  <p className="text-sm text-destructive">
                    {actionData.fieldErrors.file}
                  </p>
                )}
              </div>

              {/* Review Summary */}
              <Card
                className={`border-dashed transition-colors ${
                  showReview ? "border-primary/40" : "border-border"
                }`}
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between p-3 text-left"
                  onClick={() => setShowReview(!showReview)}
                >
                  <div className="flex items-center gap-2">
                    <ClipboardList className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">
                      Review your submission before sending
                    </span>
                  </div>
                  {showReview ? (
                    <ChevronUp className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
                {showReview && (
                  <div className="border-t px-3 pb-3">
                    <div className="mt-3 space-y-2 text-sm">
                      <div>
                        <p className="font-medium text-muted-foreground">Idea Title</p>
                        <p>{ideaTitle || "(not set)"}</p>
                      </div>
                      <div>
                        <p className="font-medium text-muted-foreground">Tech Stack</p>
                        <p>{techStack || "(not set)"}</p>
                      </div>
                      <div>
                        <p className="font-medium text-muted-foreground">Description</p>
                        <p className="line-clamp-4 text-muted-foreground">
                          {ideaDescription || "(not set)"}
                        </p>
                      </div>
                      <div>
                        <p className="font-medium text-muted-foreground">File</p>
                        <p>{selectedFile?.name ?? team?.submission_file ?? "(no file selected)"}</p>
                      </div>
                    </div>
                  </div>
                )}
              </Card>

              {submissionOpen && (
                <Button
                  type="submit"
                  className="w-full"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
