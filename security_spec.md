# Security Specification for Metaassist

## 1. Data Invariants
- An `Org` must have a valid `orgId` and the `ownerUid` MUST match `request.auth.uid`.
- `MetadataItem` and sub-resources (chunks, assignments) are only accessible if the user owns the parent `Org`.
- A `User` profile is strictly private to that user (except for admins).
- `SalesforceSession` and `TargetOrgCredentials` contain sensitive tokens and must be strictly protected.
- `sf_creds` (Salesforce Client ID/Secret) are restricted to `isAdmin()`.
- Timestamps (`createdAt`, `updatedAt`, `lastSyncAt`) must be server-validated.
- All IDs must follow a strict pattern: `^[a-zA-Z0-9_\\-]+$` and be <= 128 chars.

## 2. The "Dirty Dozen" Payloads
These payloads should always return `PERMISSION_DENIED`.

1. **Identity Spoofing (User Profile)**: `create` user with `uid` != `request.auth.uid`.
2. **Privilege Escalation**: `create`/`update` user with `role: 'admin'`.
3. **Ghost Field (Org)**: `create` org with `extra_field: 'malicious'`.
4. **ID Poisoning**: `get` org with ID `../../../etc/passwd` or a 2KB string.
5. **Orphaned Write**: `create` metadata item for an `orgId` that doesn't exist or isn't owned by the user.
6. **Immutable Field Breach**: `update` org and change `ownerUid`.
7. **PII Leak**: `get` another user's `/users/{userId}` profile.
8. **Sensitive Data Scraping**: `list` all `/sessions` without owning them.
9. **DOW (Denial of Wallet)**: `create` metadata item with 2MB `name` or 10MB `content`. (Rules limit to 1MB which is Firestore max anyway, but we should enforce it).
10. **Terminal State Lock-out**: (N/A currently but good practice)
11. **Spoofed Timestamp**: `create` org with `lastSyncAt: "2099-01-01T00:00:00Z"`.
12. **Relationship Sync Failure**: `create` metadata chunk for a metadata item the user doesn't own.

## 3. The Test Runner
I will create `firestore.rules.test.ts` to verify these. (Note: I'll use the available tools to run tests if possible, but first I need to generate the rules).
