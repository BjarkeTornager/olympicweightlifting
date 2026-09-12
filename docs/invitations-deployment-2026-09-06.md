# Private Google invitations — verified Railway release

- Site: https://lift-journal-production.up.railway.app
- Settings: https://lift-journal-production.up.railway.app/#data
- Railway deployment: `a61a07d3-f704-48bb-8233-1271477de959`, **SUCCESS**.
- Created: 6 September 2026, 17:45:56 UTC.
- Published source: `c007c0221947616f86cb59375b3a3a9315ceb04a`.
- Service worker: `lift-cloud-UjrMVUl_z1KFP7TXwLWG2`.

## Access behavior

The server-only `OWNER_EMAIL` identifies the sole invitation administrator. Production sign-in requires a verified Google identity belonging to that owner or an active invitation. Production passwords are disabled and the previous environment allowlist cannot admit additional users. Missing owner configuration fails closed.

Settings → Invitations lets the owner grant an exact email access, copy an invitation for manual sharing, revoke access or restore it. There is no automatic email delivery. A shared link does not grant a different Google account access. Each athlete's records remain private to their own account. Invitation administration grants no access to another athlete's health data.

The additive `0005_giant_firelord` migration creates `journal_invitations`. Runtime permissions were checked after migration. Revocation disables the invitation and deletes existing sessions in one transaction, retaining the journal. New session creation, private APIs and raw authentication session/account endpoints enforce admission. No production accounts, invitations or health entries were created during release verification.

## Validation

- 152 local checks passed: 23 progression, 45 domain/database/auth/provider, 84 browser checks.
- Both CI runs for the exact published source passed: push `34049220435`, PR `34049224390`. They include a fresh PostgreSQL migration, type checking, lint, dependency audit, production build and three-browser suite.
- The preceding CI run caught JSX punctuation in the new privacy paragraph; this was corrected before deployment. The failed source was never published.
- Google admission tests cover unverified and uninvited profiles, owner-only administration, normalized email grants, existing/revoked/stale sessions, isolation, restoration and preservation of journal data.
- Deployed `/api/health` and `/api/ready` returned 200. Anonymous `/api/session` returned no user, Google enabled, password login disabled and no invitation capability.
- `scripts/check-public-access.mjs` passed against production, including invitation GET/POST/DELETE denial, private records/images/chat, private-file paths, cache headers and origin checks.
- Six focused browser checks passed against deployed assets in Chromium, WebKit and Firefox, with synthetic session/invitation responses. Mobile layout and accessibility were checked; tests did not sign into a real Google account or change production membership.
- A sanitized database audit confirmed the existing owner has a verified Google binding and that the new table is accessible to the restricted runtime role. Public browser assets contained no owner configuration, owner email or invitation SQL markers.

Encrypted pre-migration backup: `railway-2026-09-06T17-31-36.611Z.pgdump.enc`, using the existing private backup store and key. The archive and credentials were not included in Git or the deployment. Deployment used a clean Git archive; untracked artifacts were excluded.

See [private access boundaries](private-access.md) for device-storage behavior and the limits of these checks. This release does not add an Apple Health connection.
