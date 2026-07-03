export { default as ErrorBoundary } from "~/components/shared/route-error-boundary";
import { Building2, CheckCircle, Mail, MapPin, Upload, Users, XCircle } from "lucide-react";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { PanelHeader } from "~/components/shared/panel-header";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { fail, ok, secureAction } from "~/lib/action.server";
import { secureLoader } from "~/lib/loader.server";
import { createCampusLeadSchema } from "~/lib/schemas/campus-leads";
import { createCampusLead } from "~/lib/team.server";
import { extractFieldErrors } from "~/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Valid institution code: uppercase letters and digits only. */
const CODE_PATTERN = /^[A-Z0-9]+$/i;

/** Simple CSV line parser — handles quoted fields and RFC 4180 escaped quotes ("" inside quotes) */
function parseCsvLine(rawLine: string): string[] {
	// Strip trailing \r so Windows-style \r\n line endings are handled cleanly.
	const line = rawLine.replace(/\r$/, "");
	const result: string[] = [];
	let current = "";
	let inQuotes = false;
	let i = 0;
	while (i < line.length) {
		const ch = line[i];
		if (ch === '"') {
			// RFC 4180: "" inside a quoted field is an escaped quote
			if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
				current += '"';
				i += 2;
				continue;
			}
			inQuotes = !inQuotes;
			i++;
			continue;
		}
		if (ch === "," && !inQuotes) {
			result.push(current.trim());
			current = "";
			i++;
			continue;
		}
		current += ch;
		i++;
	}
	result.push(current.trim());
	return result;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

export const loader = secureLoader({ roles: ["admin"] }, async ({ user, pb }) => {
	const institutions = await pb.collection("institutions").getList<{
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
	}>(1, 1000, {
		expand: "campusLeadId",
		sort: "-created",
	});

	return { user, institutions: institutions.items };
});

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

export const action = secureAction({ roles: ["admin"] }, async ({ formData, intent, pb }) => {
	if (intent === "create-single") {
		const parsed = createCampusLeadSchema.safeParse({
			institutionName: formData.get("institutionName"),
			district: formData.get("district"),
			code: formData.get("code"),
			leadName: formData.get("leadName"),
			leadEmail: formData.get("leadEmail"),
		});

		if (!parsed.success) {
			return fail({
				fieldErrors: extractFieldErrors(parsed.error),
			});
		}

		const { institutionName, district, code, leadName, leadEmail: rawEmail } = parsed.data;
		const leadEmail = rawEmail.toLowerCase();

		try {
			// The two existence checks are independent — run in parallel.
			const [existingInst, existingUser] = await Promise.all([
				pb
					.collection("institutions")
					.getFirstListItem(pb.filter("code = {:code}", { code }))
					.catch(() => null),
				pb
					.collection("users")
					.getFirstListItem(pb.filter("email = {:email}", { email: leadEmail }))
					.catch(() => null),
			]);
			if (existingInst) {
				return fail({ error: `Institution with code "${code}" already exists` });
			}
			if (existingUser) {
				return fail({ error: `User with email "${leadEmail}" already exists` });
			}

			await createCampusLead(pb, {
				institutionName,
				district,
				code,
				leadName,
				leadEmail,
			});

			return ok({ type: "single", success: true, institutionName, leadName, leadEmail });
		} catch (err) {
			console.error("[campus-leads] create-single failed:", err);
			return fail({ error: "Failed to create campus lead" });
		}
	}

	if (intent === "bulk-create") {
		const csvFile = formData.get("csvFile");
		if (!csvFile) {
			return fail({ error: "Please upload a CSV file" });
		}
		// `csvFile` is a File when multipart, a string when urlencoded.
		let text: string;
		if (typeof csvFile === "string") {
			text = csvFile;
		} else if (typeof (csvFile as Blob).text === "function") {
			if ((csvFile as File).size === 0) {
				return fail({ error: "Please upload a CSV file" });
			}
			if ((csvFile as File).size > 1_000_000) {
				return fail({ error: "CSV file too large (max 1 MB)" });
			}
			text = await (csvFile as Blob).text();
		} else {
			return fail({ error: "Invalid CSV upload" });
		}

		const lines = text.trim().split(/\r?\n/);
		if (lines.length > 101) {
			return fail({ error: "CSV too many rows (max 100)" });
		}
		if (lines.length < 2) {
			return fail({ error: "CSV must have a header row and at least one data row" });
		}

		// Validate the header so a reordered CSV fails clearly instead of
		// silently mismapping fields into the wrong columns. Match
		// case-insensitively on the first 5 header cells.
		const EXPECTED_HEADER = ["institutionname", "district", "code", "leadname", "leademail"];
		const headerCols = parseCsvLine(lines[0]).map((c) => c.trim().toLowerCase());
		const headerMatches = EXPECTED_HEADER.every((h, i) => headerCols[i] === h);
		if (!headerMatches) {
			return fail({
				error:
					"CSV header must be: institutionName,district,code,leadName,leadEmail (in that order).",
			});
		}
		const results: Array<{ row: number; name: string; status: string; error?: string }> = [];
		let created = 0;

		for (let i = 1; i < lines.length; i++) {
			const cols = parseCsvLine(lines[i]);
			if (cols.length < 5) {
				results.push({
					row: i + 1,
					name: "unknown",
					status: "skipped",
					error: "Row has fewer than 5 columns",
				});
				continue;
			}

			const [instName, district, code, leadName, leadEmail] = cols;
			const rowNum = i + 1;

			const cleanInst = instName.trim();
			const cleanDistrict = district.trim();
			const cleanCode = code.trim();
			const cleanLeadName = leadName.trim();
			const cleanLeadEmail = leadEmail.trim().toLowerCase();

			try {
				if (!cleanInst || !cleanDistrict || !cleanCode || !cleanLeadName || !cleanLeadEmail) {
					results.push({
						row: rowNum,
						name: cleanInst || "unknown",
						status: "skipped",
						error: "Missing required field",
					});
					continue;
				}
				if (!CODE_PATTERN.test(cleanCode)) {
					results.push({
						row: rowNum,
						name: cleanInst,
						status: "skipped",
						error: "Invalid code format",
					});
					continue;
				}

				const exists = await pb
					.collection("institutions")
					.getFirstListItem(pb.filter("code = {:code}", { code: cleanCode }))
					.catch(() => null);
				if (exists) {
					results.push({
						row: rowNum,
						name: cleanInst,
						status: "skipped",
						error: "Code already exists",
					});
					continue;
				}
				// COR-5: Check for existing user with this email.
				const existingUser = await pb
					.collection("users")
					.getFirstListItem(pb.filter("email = {:email}", { email: cleanLeadEmail }))
					.catch(() => null);
				if (existingUser) {
					results.push({
						row: rowNum,
						name: cleanInst,
						status: "skipped",
						error: `Email "${cleanLeadEmail}" already exists`,
					});
					continue;
				}

				await createCampusLead(pb, {
					institutionName: cleanInst,
					district: cleanDistrict,
					code: cleanCode,
					leadName: cleanLeadName,
					leadEmail: cleanLeadEmail,
				});

				created++;
				results.push({ row: rowNum, name: cleanInst, status: "created" });
			} catch (err) {
				const message = err instanceof Error ? err.message : "Unknown error";
				results.push({
					row: rowNum,
					name: cleanInst || "unknown",
					status: "failed",
					error: message,
				});
			}
		}

		return ok({ type: "bulk", success: true, created, total: results.length, results });
	}

	return fail({ error: "Invalid intent" });
});

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function meta() {
	return [{ title: "Campus Leads — VisionHack" }];
}

interface BulkCreateRow {
	row: number;
	name: string;
	status: "created" | "skipped" | "failed";
	error?: string;
}

interface SingleSuccess {
	type: "single";
	success: true;
	institutionName: string;
	leadName: string;
	leadEmail: string;
}

interface BulkSuccess {
	type: "bulk";
	success: true;
	created: number;
	total: number;
	results: BulkCreateRow[];
}

interface Failure {
	error?: string;
	fieldErrors?: Record<string, string>;
}

type CampusLeadActionResult = SingleSuccess | BulkSuccess | Failure;

interface InstitutionRow {
	id: string;
	name: string;
	district: string;
	code: string;
	campusLeadId: string;
	maxTeams: number;
	expand?: {
		campusLeadId?: { id: string; name: string; email: string };
	};
}

export default function AdminCampusLeads() {
	const { institutions } = useLoaderData() as {
		user: { id: string; email: string; name: string };
		institutions: InstitutionRow[];
	};
	const actionData = useActionData() as CampusLeadActionResult | undefined;
	const navigation = useNavigation();
	const isSubmitting = navigation.state === "submitting";

	const singleSuccess =
		actionData && "type" in actionData && actionData.type === "single" && actionData.success
			? (actionData as SingleSuccess)
			: null;
	const bulkSuccess =
		actionData && "type" in actionData && actionData.type === "bulk" && actionData.success
			? (actionData as BulkSuccess)
			: null;
	const actionErr =
		actionData && !("success" in actionData) ? (actionData as Record<string, unknown>) : null;
	let errorMessage: string | null = null;
	if (actionErr?.error) {
		errorMessage = actionErr.error as string;
	} else if (
		actionErr?.fieldErrors &&
		typeof actionErr.fieldErrors === "object" &&
		actionErr.fieldErrors != null
	) {
		errorMessage = Object.values(actionErr.fieldErrors as Record<string, string>).join(". ");
	}
	return (
		<div className="space-y-10">
			<PanelHeader
				eyebrow="Operations"
				title="Campus leads"
				description="Create and manage campus leads and institutions."
			/>

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
									<Input id="district" name="district" placeholder="e.g., Thrissur" required />
								</div>
								<div className="space-y-2">
									<Label htmlFor="code">Institution Code *</Label>
									<Input id="code" name="code" placeholder="e.g., SCET001" required />
								</div>
								<div className="space-y-2">
									<Label htmlFor="leadName">Campus Lead Name *</Label>
									<Input id="leadName" name="leadName" placeholder="e.g., John Doe" required />
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
								<div className="space-y-2 sm:col-span-2">
									<p className="text-xs text-muted-foreground">
										The campus lead will receive a set-password link by email. No password is set by
										the admin.
									</p>
								</div>
							</div>

							{singleSuccess && (
								<div className="rounded-md border border-success/30 bg-success/8 px-3 py-2.5 text-sm text-success">
									<CheckCircle className="mr-1.5 inline h-4 w-4" />
									Created {singleSuccess.institutionName} with lead {singleSuccess.leadName} (
									{singleSuccess.leadEmail})
								</div>
							)}

							{errorMessage && (
								<div
									role="alert"
									className="vh-shake rounded-md border border-danger/30 bg-danger/8 px-3 py-2.5 text-sm text-danger"
								>
									<XCircle className="mr-1.5 inline h-4 w-4" />
									{errorMessage}
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
							Upload a CSV file with columns: Name, District, Code, Lead Name, Lead Email. The lead
							receives a set-password link by email.
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
								<Input type="file" name="csvFile" accept=".csv" className="mt-3" required />
							</div>

							{bulkSuccess && (
								<div className="rounded-md border border-success/30 bg-success/8 px-3 py-2.5 text-sm text-success">
									<CheckCircle className="mr-1.5 inline h-4 w-4" />
									Created {bulkSuccess.created} of {bulkSuccess.total} entries.
									{bulkSuccess.results.filter((r) => r.status === "skipped").length > 0 && (
										<span>
											{" "}
											{bulkSuccess.results.filter((r) => r.status === "skipped").length} skipped
											(duplicate codes).
										</span>
									)}
								</div>
							)}
							{errorMessage && (
								<div
									role="alert"
									className="vh-shake rounded-md border border-danger/30 bg-danger/8 px-3 py-2.5 text-sm text-danger"
								>
									<XCircle className="mr-1.5 inline h-4 w-4" />
									{errorMessage}
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
					{institutions.map((inst) => (
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
										{inst.expand.campusLeadId.name} ({inst.expand.campusLeadId.email})
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
