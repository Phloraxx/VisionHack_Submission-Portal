import { useState } from "react";
import {
  useLoaderData,
  Form,
  useNavigation,
  useActionData,
} from "react-router";
import type { LoaderFunctionArgs, ActionFunctionArgs } from "react-router";
import { requireRole } from "~/lib/auth.server";
import { createSuperuserClient } from "~/lib/pocketbase.server";
import { validateOrigin } from "~/lib/csrf.server";
import { generateSecurePassword } from "~/lib/password";
import type { InstitutionRecord } from "~/lib/types";
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
  Users,
  Mail,
  CheckCircle,
  XCircle,
  Building2,
  MapPin,
  Upload,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse a single CSV line, handling quoted fields with commas */
function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === "," && !inQuotes) { result.push(current); current = ""; continue; }
    current += ch;
  }
  result.push(current);
  return result;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export async function loader({ request }: LoaderFunctionArgs) {
  const { user } = await requireRole(request, ["admin"]);
  const pb = createSuperuserClient();

  const institutions = await pb.collection("institutions").getFullList<{
    id: string;
    name: string;
    district: string;
    code: string;
    campusLeadId: string;
    expand?: {
      campusLeadId?: {
        id: string;
        name: string;
        email: string;
      };
    };
  }>({
    expand: "campusLeadId",
    sort: "-created",
  });

  return { user, institutions };
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export async function action({ request }: ActionFunctionArgs) {
  validateOrigin(request);
  const { user } = await requireRole(request, ["admin"]);
  const pb = createSuperuserClient();

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create-single") {
    const institutionName = formData.get("institutionName") as string;
    const district = formData.get("district") as string;
    const code = formData.get("code") as string;
    const leadName = formData.get("leadName") as string;
    const leadEmail = formData.get("leadEmail") as string;
    const leadPassword = formData.get("leadPassword") as string;

    if (
      !institutionName ||
      !district ||
      !code ||
      !leadName ||
      !leadEmail ||
      !leadPassword
    ) {
      return { success: false, error: "All fields are required" };
    }

    try {
      // Check if institution code already exists
      const existingInst = await pb
        .collection("institutions")
        .getFirstListItem(pb.filter('code = {:code}', { code }))
        .catch(() => null);
      if (existingInst) {
        return {
          success: false,
          error: `Institution with code "${code}" already exists`,
        };
      }

      // Check if user email already exists
      const existingUser = await pb
        .collection("users")
        .getFirstListItem(pb.filter('email = {:email}', { email: leadEmail }))
        .catch(() => null);
      if (existingUser) {
        return {
          success: false,
          error: `User with email "${leadEmail}" already exists`,
        };
      }

      // Create campus lead user
      const campusLead = await pb.collection("users").create({
        email: leadEmail,
        password: leadPassword,
        passwordConfirm: leadPassword,
        name: leadName,
        role: "institution",
      });

      // Create institution
      const institution = await pb.collection("institutions").create({
        name: institutionName,
        district,
        code,
        campusLeadId: campusLead.id,
        maxTeams: 5,
        status: "active",
      });

      return {
        success: true,
        type: "single",
        institutionName,
        leadName,
        leadEmail,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || "Failed to create campus lead",
      };
    }
  }

  if (intent === "bulk-create") {
    const csvFile = formData.get("csvFile") as File | null;
    if (!csvFile || csvFile.size === 0) {
      return { success: false, error: "Please upload a CSV file" };
    }

    const text = await csvFile.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) {
      return { success: false, error: "CSV must have a header row and at least one data row" };
    }

    const results: Array<{ row: number; name: string; status: string; error?: string }> = [];
    let created = 0;

    for (let i = 1; i < lines.length; i++) {
      // Parse CSV: Name,District,Code,LeadName,LeadEmail,Password
      const cols = parseCsvLine(lines[i]);
      if (cols.length < 5) continue;

      const [instName, district, code, leadName, leadEmail, leadPassword] = cols;
      const password = (leadPassword || "").trim() || generateSecurePassword();
      const rowNum = i + 1;

      try {
        // Check duplicate code
        const exists = await pb.collection("institutions")
          .getFirstListItem(pb.filter('code = {:code}', { code: code.trim() }))
          .catch(() => null);
        if (exists) {
          results.push({ row: rowNum, name: instName.trim(), status: "skipped", error: "Code already exists" });
          continue;
        }

        // Create user
        const campusLead = await pb.collection("users").create({
          email: leadEmail.trim().toLowerCase(),
          password,
          passwordConfirm: password,
          name: leadName.trim(),
          role: "institution",
        });

        // Create institution
        await pb.collection("institutions").create({
          name: instName.trim(),
          district: district.trim(),
          code: code.trim(),
          campusLeadId: campusLead.id,
          maxTeams: 5,
          status: "active",
        });

        created++;
        results.push({ row: rowNum, name: instName.trim(), status: "created" });
      } catch (err: any) {
        results.push({ row: rowNum, name: instName?.trim() || "unknown", status: "failed", error: err.message });
      }
    }

    return { success: true, type: "bulk", created, total: results.length, results };
  }

  return { success: false, error: "Invalid intent" };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function meta() {
  return [{ title: "Campus Leads — VisionHack" }];
}

export default function AdminCampusLeads() {
  const { institutions } = useLoaderData() as {
    user: any;
    institutions: any[];
  };
  const actionData = useActionData() as any;
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">
          Campus Leads
        </h1>
        <p className="mt-1 text-muted-foreground">
          Create and manage campus leads and institutions.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ========== Single Creation ========== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4" />
              Create Single Campus Lead
            </CardTitle>
            <CardDescription>
              Create one institution and campus lead account at a time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" className="space-y-4">
              <input type="hidden" name="intent" value="create-single" />

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="institutionName">Institution Name *</Label>
                  <Input
                    id="institutionName"
                    name="institutionName"
                    placeholder="e.g., SCET"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="district">District *</Label>
                  <Input
                    id="district"
                    name="district"
                    placeholder="e.g., Thrissur"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="code">Institution Code *</Label>
                  <Input
                    id="code"
                    name="code"
                    placeholder="e.g., SCET001"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="leadName">Campus Lead Name *</Label>
                  <Input
                    id="leadName"
                    name="leadName"
                    placeholder="e.g., John Doe"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="leadEmail">Campus Lead Email *</Label>
                  <Input
                    id="leadEmail"
                    name="leadEmail"
                    type="email"
                    placeholder="john@scet.ac.in"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="leadPassword">Password *</Label>
                  <Input
                    id="leadPassword"
                    name="leadPassword"
                    type="password"
                    placeholder="Min 8 characters"
                    required
                    minLength={8}
                  />
                </div>
              </div>

              {actionData?.type === "single" && actionData.success && (
                <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
                  <CheckCircle className="mr-1.5 inline h-4 w-4" />
                  Created {actionData.institutionName} with lead{" "}
                  {actionData.leadName} ({actionData.leadEmail})
                </div>
              )}

              {actionData?.error && actionData.type === "single" && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  <XCircle className="mr-1.5 inline h-4 w-4" />
                  {actionData.error}
                </div>
              )}

              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Campus Lead"}
              </Button>
            </Form>
          </CardContent>
        </Card>

        {/* ========== Bulk CSV Upload ========== */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" />
              Bulk Import via CSV
            </CardTitle>
            <CardDescription>
              Upload a CSV file with columns: Name, District, Code, Lead Name, Lead Email, Password (optional — auto-generated if blank)
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Form method="post" encType="multipart/form-data" className="space-y-4">
              <input type="hidden" name="intent" value="bulk-create" />
              <div className="rounded-lg border-2 border-dashed border-border p-6 text-center transition-colors hover:bg-muted/50">
                <Upload className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">Click to upload CSV</p>
                <p className="text-xs text-muted-foreground mt-1">
                  .csv format — first row is header
                </p>
                <Input
                  type="file"
                  name="csvFile"
                  accept=".csv"
                  className="mt-3"
                  required
                />
              </div>

              {actionData?.success && actionData.type === "bulk" && (
                <div className="rounded-md bg-green-50 p-3 text-sm text-green-700 dark:bg-green-900/30 dark:text-green-300">
                  <CheckCircle className="mr-1.5 inline h-4 w-4" />
                  Created {actionData.created} of {actionData.total} entries.
                  {actionData.results?.filter((r: any) => r.status === "skipped").length > 0 && (
                    <span> {actionData.results.filter((r: any) => r.status === "skipped").length} skipped (duplicate codes).</span>
                  )}
                </div>
              )}
              {actionData?.error && actionData.type === "bulk" && (
                <div className="rounded-md bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
                  <XCircle className="mr-1.5 inline h-4 w-4" />
                  {actionData.error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? "Importing..." : "Upload & Import"}
              </Button>
            </Form>
          </CardContent>
        </Card>
      </div>

      {/* ========== Existing Institutions List ========== */}
      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-3">
          Existing Institutions ({institutions.length})
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {institutions.map((inst: any) => (
            <Card key={inst.id}>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  {inst.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-2 text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <MapPin className="h-3 w-3" />
                  {inst.district}
                </div>
                <div className="font-mono">Code: {inst.code}</div>
                {inst.expand?.campusLeadId && (
                  <div className="flex items-center gap-1.5 pt-1 border-t">
                    <Mail className="h-3 w-3" />
                    {inst.expand.campusLeadId.name} (
                    {inst.expand.campusLeadId.email})
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
          {institutions.length === 0 && (
            <p className="text-sm text-muted-foreground col-span-full">
              No institutions created yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
