/**
 * Canonical list of event feature flags (phases). Single source of truth
 * for both the admin config screen and any count/derived UI.
 */
export interface FeatureFlag {
  key: string;
  label: string;
  description: string;
  step: number;
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  {
    key: "registration_open",
    label: "Registration",
    description: "Campus leads can invite team leads",
    step: 1,
  },
  {
    key: "questionnaire_open",
    label: "Questionnaire",
    description: "Teams can submit their questionnaire",
    step: 2,
  },
  {
    key: "nomination_open",
    label: "Nomination",
    description: "Campus leads can shortlist teams",
    step: 3,
  },
  {
    key: "submission_open",
    label: "Submission",
    description: "Teams can submit their ideas",
    step: 4,
  },
];

/** Valid feature-flag keys (for whitelisting in the config action). */
export const FEATURE_FLAG_KEYS = FEATURE_FLAGS.map((f) => f.key);
