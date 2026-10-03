// The only attributes a trace may carry. Every key has a validator, and a
// value is kept only as a number, a boolean, a value from a fixed list or a
// short slug (model ids, tool names). Free text has nowhere to go: an unknown
// key or a value that fails its check is dropped and counted in
// lift.dropped_attrs.
//
// Plain values follow the OpenTelemetry GenAI conventions MLflow reads:
// gen_ai.operation.name gives the span type, gen_ai.usage.* the token counts,
// user.id and session.id the trace's user and session.

export type AttributeValue = string | number | boolean | string[];
type Validator = (value: unknown) => AttributeValue | undefined;

// Model ids such as openai/gpt-5.6-luna and known tool or skill names.
const SLUG = /^[a-z0-9][a-z0-9._:/-]{0,63}$/;

const count: Validator = (v) =>
  typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : undefined;
const amount: Validator = (v) =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
const flag: Validator = (v) => (typeof v === "boolean" ? v : undefined);
const slug: Validator = (v) =>
  typeof v === "string" && SLUG.test(v) ? v : undefined;
const slugs: Validator = (v) =>
  Array.isArray(v) &&
  v.length <= 32 &&
  v.every((s) => typeof s === "string" && SLUG.test(s))
    ? [...v]
    : undefined;
const matching =
  (pattern: RegExp): Validator =>
  (v) =>
    typeof v === "string" && pattern.test(v) ? v : undefined;
const oneOf =
  (...values: string[]): Validator =>
  (v) =>
    typeof v === "string" && values.includes(v) ? v : undefined;
const either =
  (...validators: Validator[]): Validator =>
  (v) => {
    for (const validate of validators) {
      const valid = validate(v);
      if (valid !== undefined) return valid;
    }
    return undefined;
  };

export const attributes = {
  "gen_ai.operation.name": oneOf("invoke_agent", "chat", "execute_tool"),
  "gen_ai.provider.name": oneOf("openrouter", "ollama", "typesafe"),
  "gen_ai.request.model": slug,
  "gen_ai.response.model": slug,
  "gen_ai.usage.input_tokens": count,
  "gen_ai.usage.output_tokens": count,
  "gen_ai.usage.cache_read.input_tokens": count,
  "gen_ai.tool.name": matching(/^[a-z][a-z0-9_]{0,47}$/),
  // HMAC codes (ids.ts), never the account id.
  "user.id": matching(/^[0-9a-f]{32}$/),
  "session.id": matching(/^[0-9a-f]{32}$/),

  // A Coach turn.
  "lift.streaming": flag,
  "lift.background": flag,
  "lift.language": oneOf("en", "da"),
  "lift.photo_count": count,
  "lift.workout_open": flag,
  "lift.direct_logging": flag,
  "lift.status": oneOf("done", "failed", "cancelled", "timeout", "replay"),
  // An errorCategory from lib/error-log.ts: a class name, status or code.
  "lift.error": matching(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
  "lift.incident": matching(/^[0-9a-f]{8}$/),
  "lift.total_ms": amount,
  "lift.first_text_ms": amount,
  "lift.rounds": count,
  "lift.tools_called": count,
  "lift.skills": slugs,
  "lift.proposal": flag,
  "lift.direct_save": flag,
  "lift.change_kinds": slugs,
  "lift.cost_usd_total": amount,

  // Preparation and the wait for photos to be sorted.
  "lift.history_turns": count,
  "lift.voice_transcripts": count,
  "lift.context_chars": count,
  "lift.wait_ms": amount,
  "lift.pending_photos": count,
  "lift.timed_out": flag,

  // Routing, rounds and model calls.
  "lift.tier": oneOf("luna", "terra", "astra"),
  "lift.route": oneOf("off", "rules", "jev", "fallback"),
  // True on the content-filter retry; on routing, why Jev was not used.
  "lift.fallback": either(flag, oneOf("timeout", "error", "no_key")),
  "lift.round": count,
  "lift.round_kind": oneOf("normal", "meal_reminder", "answering"),
  "lift.tools_offered": count,
  "lift.tool_calls": count,
  "lift.reason": oneOf("too_many_tools", "multiple_changes"),
  "lift.cache_write_tokens": count,
  "lift.cost_usd": amount,
  "lift.first_token_ms": amount,
  "lift.image_count": count,
  "lift.tool_calls_returned": count,
  "lift.filtered": flag,
  "lift.truncated": flag,

  // Tools: outcome, timing and counts only.
  "lift.ok": flag,
  "lift.ms": amount,
  "lift.result_chars": count,
  "lift.result_too_large": flag,
  "lift.result_count": count,
  "lift.skills_loaded": count,
  "lift.guard_rejected": flag,
  "lift.rows": count,

  // What started a photo's tagging or a call transcript's tidying.
  "lift.trigger": oneOf(
    "upload",
    "upload_background",
    "retag",
    "retry",
    "final",
    "catch_up",
  ),
  // Photo tagging. Never the category or the tags: they say what a photo
  // shows.
  "lift.tag_count": count,
  "lift.confident": flag,

  // Voice calls: setup, tools, connection reports and transcript tidying.
  "lift.provider": oneOf("google", "elevenlabs"),
  "lift.purpose": oneOf("checkin", "goals"),
  "lift.resumed": flag,
  "lift.cards": flag,
  "lift.instruction_chars": count,
  "lift.http_status": count,
  "lift.saved": flag,
  "lift.socket_event": oneOf(
    "socket_closed",
    "go_away",
    "reconnected",
    "reconnect_failed",
  ),
  "lift.close_code": count,
  "lift.reconnect_attempts": count,
  "lift.lines": count,
  "lift.chunks": count,

  // Video reviews: the job's attempt, how far it got and each stage.
  "lift.attempt": count,
  "lift.mode": oneOf("automatic", "manual"),
  "lift.phase_reached": oneOf(
    "queued",
    "preparing",
    "tracking",
    "coaching",
    "body",
    "ready",
  ),
  "lift.outcome": oneOf("done", "requeued", "waiting", "failed", "stopped"),
  "lift.frames": count,
  "lift.clip_attempts": count,
  // A GPU job still running, resumed by a later attempt.
  "lift.waiting": flag,
  "lift.pass": count,
  "lift.repair": flag,
  "lift.valid": flag,
  "lift.review_failure": oneOf(
    "invalid_json",
    "response_schema",
    "phase_schema",
    "phase_evidence",
    "coaching_schema",
    "coaching_evidence",
    "attempt_range",
    "truncated",
    "tool_calls",
  ),

  "lift.dropped_attrs": count,
} satisfies Record<string, Validator>;

export type AttributeKey = keyof typeof attributes;
export type SpanAttributes = Partial<Record<AttributeKey, unknown>>;

// A trace's root: one unit of work.
export const rootNames = [
  "coach_turn",
  "image_tag",
  "voice_setup",
  "voice_tool",
  "voice_socket",
  "voice_tidy",
  "video_job",
] as const;
export type RootName = (typeof rootNames)[number];

// Root spans, steps and model calls. Tool spans are tool.<name> for a tool
// Coach offers and tool.unknown otherwise (spans.ts).
export const spanNames = [
  ...rootNames,
  // A Coach turn.
  "prepare",
  "photos_sorted",
  "route",
  "round",
  "chat",
  "commit",
  // Voice setup.
  "context",
  "mint_token",
  "signed_url",
  // A video job.
  "process_video",
  "identify",
  "refine",
  "sam3",
  "overlay_recovery",
  "review",
  "body_reconstruction",
] as const;
export type SpanName = (typeof spanNames)[number] | `tool.${string}`;
export const eventNames = ["batch_guard"] as const;
export type EventName = (typeof eventNames)[number];

export function spanName(name: string) {
  if ((spanNames as readonly string[]).includes(name)) return name;
  return /^tool\.[a-z][a-z0-9_]{0,47}$/.test(name) ? name : "tool.unknown";
}

// The allowed attributes, and how many were dropped. Undefined means "not
// set" and is skipped without counting.
export function allowed(input: SpanAttributes) {
  const kept: Record<string, AttributeValue> = {};
  let dropped = 0;
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const validate = Object.hasOwn(attributes, key)
      ? attributes[key as AttributeKey]
      : undefined;
    const valid = validate?.(value);
    if (valid === undefined) dropped++;
    else kept[key] = valid;
  }
  return { kept, dropped };
}
