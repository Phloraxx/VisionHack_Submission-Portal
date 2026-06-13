export type TeamStatus =
  | "invited"
  | "registered"
  | "shortlisted"
  | "submitted"
  | "selected"
  | "rejected"
  | "withdrawn";

export type Role = "admin" | "coordinator" | "institution" | "lead";

export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  institutionId: string;
  created: string;
  updated: string;
}

export interface TeamRecord {
  id: string;
  name: string;
  teamName: string;
  institutionId: string;
  leaderUserId: string;
  teamCode: string;
  status: TeamStatus;
  membersCount: number;
  institutionName: string;
  teamLeadName: string;
  teamLeadEmail: string;
  mentor_name: string;
  mentor_contact: string;
  idea_title?: string;
  idea_desc?: string;
  idea_tech_stack?: string;
  submission_file?: string;
  created: string;
  updated: string;
}

export interface MemberRecord {
  id: string;
  teamId: string;
  fullName: string;
  email: string;
  phone: string;
  gender: string;
  role: string;
  created: string;
  updated: string;
}

export interface InstitutionRecord {
  id: string;
  name: string;
  district: string;
  code: string;
  campusLeadName: string;
  campusLeadEmail: string;
  teamsRegistered: number;
  campusLeadId: string;
  maxTeams: number;
  status: string;
  created: string;
  updated: string;
}

export interface ConfigRecord {
  id: string;
  key: string;
  value: boolean;
  created: string;
  updated: string;
}

export interface QuestionnaireResponseRecord {
  id: string;
  teamId: string;
  userId: string;
  [field: string]: unknown;
  created: string;
  updated: string;
}

// ---------------------------------------------------------------------------
// Team Status State Machine
// ---------------------------------------------------------------------------

interface TransitionRule {
  from: TeamStatus[];
  to: TeamStatus[];
  allowedRoles: Role[];
}

const TRANSITION_RULES: TransitionRule[] = [
  // Lead transitions
  { from: ["invited"], to: ["registered"], allowedRoles: ["lead"] },
  { from: ["shortlisted"], to: ["submitted"], allowedRoles: ["lead"] },
  {
    from: ["invited", "registered", "shortlisted", "submitted"],
    to: ["withdrawn"],
    allowedRoles: ["lead", "admin"],
  },

  // Coordinator / Admin / Institution transitions
  {
    from: ["registered"],
    to: ["shortlisted"],
    allowedRoles: ["coordinator", "admin", "institution"],
  },
  {
    from: ["shortlisted"],
    to: ["registered"],
    allowedRoles: ["institution", "coordinator", "admin"],
  },

  // Admin-only transitions
  { from: ["submitted"], to: ["selected"], allowedRoles: ["admin"] },
  { from: ["submitted"], to: ["rejected"], allowedRoles: ["admin"] },
];

/**
 * Check whether a given status transition is allowed for a given role.
 *
 * ```ts
 * canTransition("invited", "registered", "lead")        // true
 * canTransition("registered", "shortlisted", "lead")     // false
 * canTransition("questionnaire_submitted", "shortlisted", "admin") // true
 * ```
 */
export function canTransition(
  from: TeamStatus,
  to: TeamStatus,
  role: Role,
): boolean {
  return TRANSITION_RULES.some(
    (rule) =>
      rule.from.includes(from) &&
      rule.to.includes(to) &&
      rule.allowedRoles.includes(role),
  );
}
