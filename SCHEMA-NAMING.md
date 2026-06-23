# Schema Field Naming Convention

**Status:** Known issue (P2.6 from planner audit)
**Priority:** Low

## Problem
PocketBase collections use `snake_case` field names (`idea_title`, `team_experience`, `status_changed_at`, `college_name`).
TypeScript types in `app/lib/types.ts` keep snake_case for PB record shapes (matching the API).
But form field names and component props mix both conventions inconsistently:
- `getStr(formData, "college_name")` — snake_case (PB convention)
- `teamName`, `memberEmail` — camelCase (TS convention)

## Impact
Minor readability tax. No functional impact since the form field names must match PB's expected names for the API calls.

## Recommendation
- **Short term:** Keep as-is. PB's API convention dictates snake_case for collection field names, and the form field names must match.
- **Medium term:** Add a mapping layer in `form.server.ts` that translates camelCase form field names to snake_case PB field names. Or document that form fields should use snake_case to match PB.
- **Alternatively:** Use Zod schemas (which are already defined in `app/lib/schemas/`) consistently across all routes with a transformer that maps camelCase ↔ snake_case.
