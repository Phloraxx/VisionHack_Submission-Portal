/**
 * Coordinator Team Detail — reuses the admin team-detail route.
 *
 * The admin/team-detail loader detects the role context from the URL path
 * (`/admin/` vs `/coordinator/`) and enforces the correct role. Status
 * transitions are filtered by role via `getValidTransitions()`, so
 * coordinators see only the actions their role permits (shortlist/reject).
 *
 * This barrel re-export avoids duplicating the loader, action, and meta
 * logic. If the shared component needs to diverge significantly between
 * roles, split this into its own file.
 */
export {
  loader,
  action,
  meta,
  default as default,
} from "../admin/team-detail";
