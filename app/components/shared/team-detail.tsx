import { Form, Link } from "react-router";
import {
  STATUS_LABELS,
  STATUS_COLORS,
} from "~/lib/team-status";
import type { TeamStatus, TeamRecord, MemberRecord } from "~/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Separator } from "~/components/ui/separator";
import {
  ArrowLeft,
  User,
  Mail,
  Phone,
  Users,
  Building2,
  MapPin,
  Download,
  Lightbulb,
  FileText,
  CalendarIcon,
  ChevronRight,
} from "lucide-react";
import { ConfirmButton } from "./confirm-button";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TeamDetailProps {
  team: TeamRecord & {
    expand?: {
      institutionId?: { name: string; district: string; code: string };
      leaderUserId?: { name: string; email: string };
    };
  };
  members: MemberRecord[];
  questionnaire: any | null;
  validTransitions: TeamStatus[];
  /** Back link URL, e.g. "/admin/teams" or "/coordinator/dashboard" */
  backUrl: string;
  /** Back link label, e.g. "Back to Teams" or "Back to Dashboard" */
  backLabel: string;
  /** Optional export card to render in the right column (e.g. download CSV card) */
  exportCard?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Client-side CSV download helper
// ---------------------------------------------------------------------------

export function downloadTeamCSV(
  team: any,
  members: MemberRecord[],
  questionnaire: any,
) {
  const escapeCsv = (str: string | null | undefined) => {
    if (!str) return "";
    const s = String(str).replace(/"/g, '""');
    return s.includes(",") || s.includes('"') || s.includes("\n")
      ? `"${s}"`
      : s;
  };

  const data: Record<string, string> = {
    "Team Name": team.name || "",
    "Team Code": team.teamCode || "",
    Status: team.status || "",
    "Idea Title": team.idea_title || "",
    "Idea Description": team.idea_desc || "",
    "Idea Tech Stack": team.idea_tech_stack || "",
    "Submission File": team.submission_file || "",
    "Created At": team.created || "",
  };

  const inst = team.expand?.institutionId;
  if (inst) {
    data["Institution"] = inst.name || "";
    data["District"] = inst.district || "";
  }

  const leader = team.expand?.leaderUserId;
  if (leader) {
    data["Team Lead Name"] = leader.name || "";
    data["Team Lead Email"] = leader.email || "";
  }

  // Flatten questionnaire
  if (questionnaire) {
    for (const [key, value] of Object.entries(questionnaire)) {
      if (
        ["id", "teamId", "userId", "created", "updated", "collectionId", "collectionName"].includes(
          key,
        )
      ) {
        continue;
      }
      data[`Questionnaire: ${key}`] = Array.isArray(value)
        ? (value as string[]).join("; ")
        : String(value ?? "");
    }
  }

  // Members
  members.forEach((m, i) => {
    data[`Member ${i + 1} Name`] = m.fullName || "";
    data[`Member ${i + 1} Email`] = m.email || "";
    data[`Member ${i + 1} Phone`] = m.phone || "";
    data[`Member ${i + 1} Gender`] = m.gender || "";
    data[`Member ${i + 1} Role`] = m.role || "";
  });

  const headers = Object.keys(data);
  const values = headers.map((h) => escapeCsv(data[h]));
  const csv = "\uFEFF" + headers.join(",") + "\n" + values.join(",");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${team.name?.replace(/[^a-z0-9]/gi, "_").toLowerCase() || "team"}_details.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Shared Team Detail Component
//
// Renders full team information: status, members, idea details, questionnaire
// responses, and status transition controls. Used by admin, coordinator, and
// lead routes with role-specific transition lists and back-navigation.
// ---------------------------------------------------------------------------

export default function TeamDetail({
  team,
  members,
  questionnaire,
  validTransitions,
  backUrl,
  backLabel,
  exportCard,
}: TeamDetailProps) {
  const colors = STATUS_COLORS[team.status];

  const inst = team.expand?.institutionId;
  const leader = team.expand?.leaderUserId;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <Link
          to={backUrl}
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          {backLabel}
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {team.name}
            </h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              {inst && (
                <span className="flex items-center gap-1">
                  <Building2 className="h-4 w-4" />
                  {inst.name}
                </span>
              )}
              {inst?.district && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-4 w-4" />
                  {inst.district}
                </span>
              )}
              {team.teamCode && (
                <span className="font-mono text-xs bg-muted px-1.5 py-0.5 rounded">
                  {team.teamCode}
                </span>
              )}
            </div>
          </div>
          <Badge className={`${colors.bg} ${colors.text} border-0 text-sm px-3 py-1 h-auto`}>
            {STATUS_LABELS[team.status]}
          </Badge>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Team Info Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Lightbulb className="h-4 w-4" />
                Team Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Idea Title
                  </p>
                  {team.idea_title ? (
                    <p className="text-sm whitespace-pre-wrap">
                      {team.idea_title}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      Not provided.
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Idea Description
                  </p>
                  {team.idea_desc ? (
                    <p className="text-sm whitespace-pre-wrap">
                      {team.idea_desc}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      Not provided.
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Tech Stack
                  </p>
                  {team.idea_tech_stack ? (
                    <p className="text-sm whitespace-pre-wrap">
                      {team.idea_tech_stack}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">
                      Not provided.
                    </p>
                  )}
                </div>
              </div>

              {team.submission_file && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">
                    Submission File
                  </p>
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`/api/files/teams/${team.id}/${team.submission_file}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <Download className="mr-1.5 h-4 w-4" />
                      Download Submission
                    </a>
                  </Button>
                </div>
              )}

              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <CalendarIcon className="h-3 w-3" />
                Created: {new Date(team.created).toLocaleString()}
              </div>
            </CardContent>
          </Card>

          {/* Members Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Users className="h-4 w-4" />
                Team Members ({members.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {members.length === 0 ? (
                <p className="text-sm text-muted-foreground italic">
                  No members registered.
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {members.map((member, idx) => (
                    <div
                      key={member.id}
                      className="border rounded-lg p-3 space-y-1.5"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-medium text-sm">{member.fullName}</p>
                        <span className="text-xs text-muted-foreground">
                          #{idx + 1}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Mail className="h-3 w-3" />
                        {member.email}
                      </div>
                      {member.phone && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Phone className="h-3 w-3" />
                          {member.phone}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <User className="h-3 w-3" />
                        {member.gender} • {member.role}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Questionnaire Responses */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Questionnaire Response
              </CardTitle>
            </CardHeader>
            <CardContent>
              {questionnaire ? (
                <div className="text-sm space-y-3">
                  {Object.entries(questionnaire)
                    .filter(
                      ([key]) =>
                        ![
                          "id",
                          "teamId",
                          "userId",
                          "created",
                          "updated",
                          "collectionId",
                          "collectionName",
                        ].includes(key),
                    )
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="flex justify-between border-b pb-1"
                      >
                        <span className="text-muted-foreground capitalize">
                          {key.replace(/_/g, " ")}
                        </span>
                        <span className="font-medium text-right max-w-[60%]">
                          {Array.isArray(value)
                            ? (value as string[]).join(", ")
                            : String(value)}
                        </span>
                      </div>
                    ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No questionnaire response submitted yet.
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column — Status & Actions */}
        <div className="space-y-6">
          {/* Status Transitions */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Status Actions</CardTitle>
              <CardDescription>
                Current:{" "}
                <Badge className={`${colors.bg} ${colors.text} border-0`}>
                  {STATUS_LABELS[team.status]}
                </Badge>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {validTransitions.length > 0 ? (
                validTransitions.map((nextStatus) => {
                  const nextColors = STATUS_COLORS[nextStatus];
                  return (
                    <Form method="post" key={nextStatus}>
                      <input type="hidden" name="intent" value="transition" />
                      <input
                        type="hidden"
                        name="toStatus"
                        value={nextStatus}
                      />
                      <ConfirmButton
                        type="submit"
                        label={`Move to ${STATUS_LABELS[nextStatus]}`}
                        confirmMessage={`Move this team to "${STATUS_LABELS[nextStatus]}"?`}
                        icon={
                          <span
                            className={`inline-block h-2 w-2 rounded-full ${nextColors.dot}`}
                          />
                        }
                        className="w-full justify-between"
                      />
                    </Form>
                  );
                })
              ) : (
                <p className="text-sm text-muted-foreground italic">
                  No status transitions available for your role.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Review Notes — visible to admin & coordinator */}
          {validTransitions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Review Notes</CardTitle>
                <CardDescription>
                  Add internal notes about this submission. Only visible to admins and coordinators.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Form method="post">
                  <input type="hidden" name="intent" value="save-notes" />
                  <Textarea
                    name="notes"
                    defaultValue={(team as any).notes || ""}
                    placeholder="Write your review notes here..."
                    className="min-h-[100px] mb-3"
                  />
                  <Button type="submit" size="sm">
                    Save Notes
                  </Button>
                </Form>
                {(team as any).reviewed_by && (
                  <p className="text-xs text-muted-foreground mt-2">
                    Last reviewed by: {(team as any).reviewed_by}
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Institution & Lead */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Institution & Lead</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {inst && (
                <div>
                  <p className="text-muted-foreground text-xs">Institution</p>
                  <p className="font-medium">{inst.name}</p>
                  {inst.code && (
                    <p className="text-xs text-muted-foreground font-mono">
                      {inst.code}
                    </p>
                  )}
                </div>
              )}
              <Separator />
              {leader && (
                <div>
                  <p className="text-muted-foreground text-xs">Team Lead</p>
                  <p className="font-medium">{leader.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {leader.email}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Export Card (custom per route) */}
          {exportCard}
        </div>
      </div>
    </div>
  );
}
