# Coach requests across journal navigation

Switching from Coach to Train, Food, Health or another journal section previously unmounted `TrainingAgent`. Its cleanup aborted the request, cancelling the AG-UI stream on the server as well. The route was also part of its React key, so links for photos, sleep and programmes could cancel a run even within Coach.

The controller now lives for the authenticated account's journal session. Internal navigation removes its visible chat and dialog portals, while the request, conversation, unsent draft and attachments remain in memory. Other sections show a compact working, reply-ready or attention status with an Open Coach link. Streaming updates cannot scroll or focus another section. Returning normally restores a deliberate history-reading position; Open Coach from the status takes the user to the latest exchange.

Navigation entry intents are applied once. Sleep, cardio, programme and photo links can prepare the next draft without replacing a running turn. Submitted photos are associated with that turn immediately, so its eventual completion cannot clear newly queued photos. Failed requests restore their submitted attachments. More than four queued photos require removing an attachment before sending.

Account changes and sign-out still unmount the controller and abort the active request. Existing private-session concealment, account headers, proposal review and revision checks remain in place. A manual journal edit made while Coach is working must not be overwritten by a stale proposal; the existing server revision check rejects that save and asks for a fresh proposal.

This fixes navigation within the open website. It does not add a durable job queue or promise execution after a reload, tab closure, browser suspension or loss of network connectivity. Existing Stop and request time limits still apply.

## Verification

- Production type checking, lint, 23 progression tests and 104 domain, database, authentication and protocol tests.
- Controlled browser streams cover navigation through Train, Food and Health during execution; completion and review after concurrent manual edits; no automatic save or duplicate request; preserved next drafts and photos; closed dialog portals; explicit cancellation; account changes and sign-out; and legacy transport failure recovery.
- Existing Coach rich response tests also verify history-reading position after leaving and returning during a stream.
- Phone and desktop layout and accessibility checks run in Chromium, Firefox and WebKit with synthetic accounts and responses. No real health records or model calls are needed for these tests.
