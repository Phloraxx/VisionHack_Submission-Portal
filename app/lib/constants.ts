export const INTENTS = {
	WITHDRAW: "withdraw",
	SHORTLIST: "shortlist",
	UNSHORTLIST: "unshortlist",
	TRANSITION: "transition",
	INVITE_LEAD: "invite-lead",
	CREATE_SINGLE: "create-single",
	BULK_CREATE: "bulk-create",
} as const;

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = [
	"application/pdf",
	"application/vnd.ms-powerpoint",
	"application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;
