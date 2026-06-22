import { useContext } from "react";
import { CsrfContext } from "~/routes/dashboard-layout";

import { Form, Link } from "react-router";
import {
  STATUS_LABELS,
} from "~/lib/team-status";
import { escapeCsv, QUESTIONNAIRE_EXCLUDE_KEYS } from "~/lib/utils";
import type {
  TeamStatus,
  TeamView,
  MemberRecord,
  QuestionnaireResponseRecord,
} from "~/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { StatusBadge } from "~/components/shared/status-badge";
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
} from "lucide-react";
import { ConfirmButton } from "./confirm-button";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface TeamDetailProps {
  team: TeamView;
  members: MemberRecord[];
  questionnaire: QuestionnaireResponseRecord | null;
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
  team: TeamView,
  members: MemberRecord[],
  questionnaire: QuestionnaireResponseRecord | null,
) {

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
      if ((QUESTIONNAIRE_EXCLUDE_KEYS as readonly string[]).includes(key)) {
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
  const inst = team.expand?.institutionId;
  const leader = team.expand?.leaderUserId;
  const csrfToken = useContext(CsrfContext);

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight">
              {team.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
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
          <div className="shrink-0 self-start sm:self-center">
            <StatusBadge status={team.status} className="text-sm px-3 py-1" />
          </div>
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
                Created:{" "}
                {team.created
                  ? new Date(team.created).toLocaleString()
                  : "—"}
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
                        !(
                          QUESTIONNAIRE_EXCLUDE_KEYS as readonly string[]
                        ).includes(key),
                    )
                    .map(([key, value]) => (
                      <div
                        key={key}
                        className="flex justify-between gap-3 border-b pb-1"
                      >
                        <span className="shrink-0 text-muted-foreground capitalize">
                          {key.replace(/_/g, " ")}
                        </span>
                        <span className="min-w-0 flex-1 break-words text-right font-medium">
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
              <CardDescription className="flex items-center gap-2">
                Current: <StatusBadge status={team.status} />
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {validTransitions.length > 0 ? (
                validTransitions.map((nextStatus) => {
                  return (
                    <Form method="post" key={nextStatus}>
                      <input type="hidden" name="csrf_token" value={csrfToken} />
                      <input type="hidden" name="intent" value="transition" />
                      <input
                        type="hidden"
                        name="toStatus"
                        value={nextStatus}
                      />
                      <ConfirmButton
                        label={`Move to ${STATUS_LABELS[nextStatus]}`}
                        confirmMessage={`Move this team to "${STATUS_LABELS[nextStatus]}"?`}
                        icon={<StatusBadge status={nextStatus} showDot compact />}
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

          {/* Review notes form removed — there are no `notes`/`reviewed_by`
              fields in the schema. To add review notes, add the fields
              via setup-pb.ts first. */}

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
