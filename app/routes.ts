import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

export default [
	// Public routes
	index("routes/home.tsx"),
	route("login", "routes/login.tsx"),
	route("forgot-password", "routes/forgot-password.tsx"),

	// Authenticated dashboard layout
	layout("routes/dashboard-layout.tsx", [
		// Admin routes
		route("admin/dashboard", "routes/admin/dashboard.tsx"),
		route("admin/campus-leads", "routes/admin/campus-leads.tsx"),
		route("admin/config", "routes/admin/config.tsx"),
		route("admin/teams", "routes/admin/teams.tsx"),
		route("admin/export", "routes/admin/export.tsx"),

		// Coordinator routes
		route("coordinator/dashboard", "routes/coordinator/dashboard.tsx"),

		// Institution routes
		route("institution/dashboard", "routes/institution/dashboard.tsx"),

		// Lead routes
		route("lead/dashboard", "routes/lead/dashboard.tsx"),
		route("lead/register", "routes/lead/register.tsx"),
		route("lead/questionnaire", "routes/lead/questionnaire.tsx"),
		route("lead/submit-idea", "routes/lead/submit-idea.tsx"),

		// Shared team detail — role-scoped via loader
		route("teams/:teamId", "routes/teams.team-id.tsx"),
	]),

	// Resource routes (API)
	route("api/auth/logout", "routes/api/auth/logout.ts"),
	route("api/institutions", "routes/api/institutions.ts"),
	route("api/export/csv", "routes/api/export/csv.ts"),
	route("api/files/:collection/:recordId/:filename", "routes/api/files.ts"),
	route("api/health", "routes/api/health.ts"),
] satisfies RouteConfig;
