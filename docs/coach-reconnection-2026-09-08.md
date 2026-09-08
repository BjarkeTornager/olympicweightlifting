# Coach connection recovery

A disabled Send button could remain labelled “Connecting…” even for an authenticated user with a clean local journal. Every sync, including read-only refreshes, waited for an exclusive browser Web Lock. An old or suspended tab holding that lock could block a new tab indefinitely. Initial Coach connection requests also lacked a timeout or automatic retry. Routine background refreshes briefly disabled sending every 15 seconds.

Journal reads now run independently of the cross-tab write lock. Atomic IndexedDB updates still preserve pending edits and conflicts; a response older than a revision newly confirmed by another tab is ignored instead of creating a false restoration conflict. A genuinely older server than the device's starting revision still requires explicit conflict resolution. Writes retain the lock, mutation ID retry and revision checks. If another tab owns the write lock, pending edits stay local and the UI explains how to recover instead of waiting indefinitely. Sync requests abort on account teardown.

A clean, connected journal stays ready during routine background reads. Failed reads still disable sending until reconnection succeeds. Initial Coach reads have a ten-second timeout and retry on return to the website, network restoration and a fifteen-second retry interval. Successful connection recovery does not reload the page, erase the current draft, submit a message or accept any pending proposal. Healthy conversation state is not periodically replaced by history reads.

The composer explains interrupted connections, pending edits, conflicts and attachment loading separately. Reconnect Coach retries the journal and, when needed, the Coach connection independently. Pending edits and conflicts remain blocking conditions; authentication and per-account data isolation are unchanged.

## Verification

- Production type checking and lint; 23 progression tests and 104 domain/database/authentication/protocol tests passed.
- Production build and offline asset generation passed.
- 81 browser checks passed across Chromium, Firefox and WebKit for Coach requests, background navigation, account privacy, local edits, offline access, revision conflicts, interrupted acknowledgements and reconnection.
- Six reconnection scenarios cover a held write lock with a clean journal, background reads and manual recovery, failed initial connection and online recovery, unsynced edits under lock contention, a hung initial request and a stale read overlapping a newer sync from another tab. Layout checks include 320px, 390px and desktop widths.
- All tests use synthetic accounts and controlled API responses. No real health entries are submitted, changed or deleted; no live model calls are needed.

Existing tabs must load this release before the new behavior applies. Unsent drafts remain in memory and do not survive a full reload; preserve that text before updating an older open tab. This change does not implement server-side durable Coach jobs or execution after closing the browser.
