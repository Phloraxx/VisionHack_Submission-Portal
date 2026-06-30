export { loginSchema, forgotPasswordSchema } from "./auth";
export type { LoginInput, ForgotPasswordInput } from "./auth";

export { registerSchema } from "./register";
export type { RegisterInput } from "./register";

export { questionnaireSchema } from "./questionnaire";
export type { QuestionnaireInput } from "./questionnaire";

export { submitIdeaSchema } from "./submit-idea";
export type { SubmitIdeaInput } from "./submit-idea";

export { createCampusLeadSchema } from "./campus-leads";
export type { CreateCampusLeadInput } from "./campus-leads";

export { configUpdateSchema } from "./config";
export type { ConfigUpdateInput } from "./config";

export { shortlistSchema, unshortlistSchema, transitionTeamSchema } from "./institution";
export type { ShortlistInput, UnshortlistInput, TransitionTeamInput } from "./institution";
