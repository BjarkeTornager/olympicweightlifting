# Coach message queue — 9 September 2026

Coach accepts further messages while a reply is running. Enter and Send append a message to a per-account, in-memory FIFO, up to 20 waiting messages. The composer stays focused; Shift+Enter still adds a line. Each message captures its own photo IDs, timezone, submission timestamp and stable run ID. Photo uploads and quick logging prompts remain available during processing.

A compact queue above the composer shows the waiting count. Expand it to see and remove pending messages. The active reply remains the latest exchange in the conversation, with its own Stop control. Internal navigation keeps the controller and queue mounted; a background status shows the remaining count. Sign-out or an account change unmounts the controller, cancels the active request and discards waiting work.

The single drain waits for the preceding reply and, after saved entries, a fresh journal sync. It then reads the committed IndexedDB snapshot rather than a render's potentially stale revision. Dirty/conflicting journals and pending manual actions suspend dispatch. Server revision and ownership checks remain authoritative, including across browser tabs.

Dropped streams first look up the owner's durable turn result. A completed result releases the queue after sync. Unknown or failed results pause it: Retry message reuses the original ID and attachments before dependents; Skip and continue syncs and proceeds, explaining that an already-saved entry is not undone. HTTP rate limits likewise pause rather than automatically repeating writes. Incoming messages remain accepted during a pause, and a separate unsent draft is never overwritten by failure recovery.

The optional, validated `submittedAt` field travels over AG-UI and the JSON compatibility transport. New requests must be within the preceding 24 hours, with one minute allowed for clock skew. The engine stores this time on the turn and uses it for relative date/time context, including failed-run retries. Legacy/native clients may omit it. A stale queue message is rejected before model execution and can be resent with its intended date.

This is an open-tab queue, not a server background worker. It continues around the website but does not survive closing/reloading the tab. The UI explains this and registers a before-unload warning while work remains; mobile browsers may not show that warning. Completed turns and saved journal receipts remain durable on the server. No additional local persistence of private queued text or images is introduced.

Validation uses synthetic accounts and deterministic provider/browser streams, with no real health records or paid model calls: FIFO and fresh revisions, midnight context and retry stability, attachments/drafts, Stop/retry/skip, rate limiting, removal, account isolation, navigation, phone layout and accessibility. Existing direct logging, AG-UI and navigation regressions are included in the full production/browser checks.
