# PocketBase Hooks

## JWT Custom Claims

PocketBase v0.23+ **automatically** includes all custom fields from auth
collection records in the JWT payload.  The `users` collection has `role`
(select) and `institutionId` (relation) fields, so every user JWT already
carries these as claims.

Consequently, RLS rules in `scripts/setup-pb.ts` can safely reference:

- `@request.auth.role`
- `@request.auth.institutionId`

**No enrichment hook is needed** — PocketBase handles this natively.  The
claims are populated from the record fields at authentication time and signed
into the JWT by PocketBase itself.

For reference, the decoded JWT payload looks like:

```json
{
  "id": "RECORD_ID",
  "collectionId": "_pb_users_auth_",
  "collectionName": "users",
  "role": "admin",
  "institutionId": "RELATION_ID_OR_NULL",
  "exp": 1900000000
}
```
