import type { MemberRecord, QuestionnaireResponseRecord, TeamView } from "~/lib/types";
import { QUESTIONNAIRE_EXCLUDE_KEYS, escapeCsv } from "~/lib/utils";

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
		data.Institution = inst.name || "";
		data.District = inst.district || "";
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
	const csv = `\uFEFF${headers.join(",")}\n${values.join(",")}`;

	const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	try {
		a.href = url;
		a.download = `${team.name?.replace(/[^a-z0-9]/gi, "_").toLowerCase() || "team"}_details.csv`;
		document.body.appendChild(a);
		a.click();
	} finally {
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}
}
