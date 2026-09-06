# Structured food records — Railway release, 6 September 2026

Live app: https://lift-journal-production.up.railway.app/#food

- Server source: `1aaf3c8373010d452cc98cb064a33f592d33dc86`.
- Railway deployment: `a9132f86-04f3-4411-9243-8eb3de781257`, **SUCCESS**, created `2026-09-06T21:02:42.087Z`.
- Service worker: `lift-cloud-JLXpkmEfx7ROGnYFMv9WF`.
- Exact-source GitHub checks: [push 34059440102](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34059440102) and [PR 34059441624](https://github.com/BjarkeTornager/olympicweightlifting/actions/runs/34059441624), both successful.

Meals retain breakfast/lunch/dinner/snack labels. Each food can have multiple food groups and ingredient tags, with reported/label/visible/estimated evidence. Web Food and native Journal support search, filtering, review and correction. Coach reads structured date/meal/group/ingredient filters, totals and tagging coverage. See [Food records and Coach queries](food-data.md) for the exact interpretation of totals and incomplete data.

Compatibility responses let cached web schemas read and save without losing server-side classifications. HTTP writes preserve omitted tags; explicit empty arrays clear them. Versioned manual undo and server-owned Coach undo retain their intended behavior. The original pre-tag server image cannot parse tagged records; any rollback must retain the new optional schema and compatibility handling.

## Verification

- Production type checking, lint, build, 23 progression tests and 58 domain/database/auth/provider tests passed. GitHub also passed the production dependency security audit.
- All 102 local browser checks passed against the final source, covering Chromium, WebKit and Firefox, including account access, image separation, Coach and manual logging.
- Seven native checks passed across the unit/UI runs, including logging ingredients, changing a saved food group, preserving nutrition and other health domains, Coach review, interrupted saves and private-screen handling. The iPhone Release build passed unsigned, with test-server overrides and synthetic credentials absent from the binary. Physical-device installation and Google handoff still require user acceptance testing.
- Three focused checks against the deployed UI passed with synthetic account traffic intercepted in each browser. No production journal writes were made by those checks.
- Live anonymous-access audit passed: private journal, Coach, image, invitation and native APIs reject anonymous requests; untrusted mutation origins are rejected; guessed users/profile/admin and sensitive file paths return 404. Landing/privacy/native connection pages reveal no journal records.
- Live health and readiness returned 200. Anonymous session: user null, Google enabled, password login disabled, invitation permission false. API responses remain private/no-store.

This release introduces no database migration, historical classification backfill or Apple Health connection. Existing ingredients remain unknown until explicitly tagged or corrected through a reviewed Coach proposal. Only the clean committed source archive was uploaded; local artifacts and secrets were excluded.
