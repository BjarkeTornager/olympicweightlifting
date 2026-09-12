# A more helpful, less demanding Coach

Coach now offers one optional starting point when the website opens, and uses a saved personal focus and recent conversations to make its replies more relevant. The default is gentle initiative. Users can choose **Advice only when I ask** in **Coach → … → Coach options**, and change or clear **What matters to you right now?** there.

## Opening experience

- A current low-energy or high-soreness report takes priority, without deciding whether the person should train.
- A sleep observation requires three consecutive recent logged nights and at least four separate baseline nights in the preceding week. Missing nights are never treated as zero, and the comparison does not infer a cause.
- Recent strength or cardio activity can prompt a reflection. Recent dinner records can start a conversation about another meal.
- Otherwise, a saved focus offers a starting point. A new conversation without useful records starts by learning what the person wants; it does not prescribe more tracking. Returning conversations without relevant records do not get that onboarding prompt again.
- Only one suggestion appears. Existing conversations get a collapsed card; the message composer and latest exchange stay reachable. **Talk it through** sends a natural question, or appends it to an existing draft without submitting or replacing that draft.
- **Hide for today** stores only the date under the account's browser namespace. It survives reload on that device and clears on sign-out or loss of access. It does not change a journal revision or invalidate a pending proposal. A different account is unaffected.

Opening observations are deterministic, computed from the signed-in journal on the device. Opening the app makes no new model request. The selected observation is supplied as untrusted context when a message is sent. This release introduces no scheduled notifications, background monitoring, Restate, wearable connections or extra infrastructure.

## Conversational behaviour and privacy

The model receives the account's optional saved focus and initiative preference, plus up to eight recent completed exchanges with their original timestamps. It should answer first, connect advice to the person's actual constraints, offer one optional step when useful, and respect declined suggestions. Earlier advice is not treated as a commitment, or an old unsaved review card as a saved record. Simple replies should usually stay below 120 words; requested plans or explanations can be longer.

There is no permanent conversation memory. Focus is saved through the options form, not automatically inferred or written from chat. The new optional `profile.coaching` field has no default added to older snapshots, preserving their shape; it uses existing account isolation, validation, revision checks, local sync, exports and imports. Clearing conversation leaves the saved focus; clearing the focus in options removes it from the profile used for subsequent chats. Previously sent messages follow the existing conversation retention policy.

All existing review-before-save and undo boundaries remain. Advice does not authorize changes to meals, sleep or training. Changing profile preferences follows normal journal revision/conflict handling. The privacy page explains storage and model context.

## Verification

Domain checks cover missing/stale/future records, sleep sample requirements, mixed strength/cardio follow-up, meal tags and dates, and legacy/export compatibility. A disposable database test verifies account isolation, focus retrieval, timestamped eight-exchange history, omission of failed/expired exchanges, and no advice-only journal writes.

Browser checks cover account-scoped dismissal, no automatic model requests, draft preservation, preference sync/reload/clearing, and the opening alongside existing conversation. Existing chat tests cover keyboard changes, streaming, reading older messages, accessibility and layout across Chromium, Firefox and WebKit.

The optional real-model check uses only a temporary synthetic account in a disposable `_test` database, then deletes it:

```sh
AGENT_PROVIDER=openrouter AGENT_MODEL=google/gemini-3.8-flash node --import tsx scripts/coaching-smoke.ts
```

On 7 September 2026 the check retrieved the synthetic health overview, related advice to a saved family-life focus, accepted a declined walk/check-in without another task, and answered a greeting without unsolicited advice in on-request mode. No health records changed. Tone is model-generated and can vary; this is behavioural guidance, not a guarantee of identical wording.

Initial local acceptance on 7 September 2026 passed: type checking, lint, 23 progression tests, 65 domain/database/authentication tests (none skipped), the production build, all 111 browser checks across Chromium/WebKit/Firefox, and the production dependency audit (zero vulnerabilities). Mobile screenshots were inspected. These changes are now published with the subsequent design, photo and ingredient improvements; see the [verified Railway release](coach-design-deployment-2026-09-07.md) for the deployed source and final combined checks.
