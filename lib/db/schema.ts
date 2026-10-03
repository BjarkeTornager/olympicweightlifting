import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  numeric,
  index,
  uniqueIndex,
  foreignKey,
  check,
  date,
  customType,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { JournalState, Workout, Entry } from "../model";
import {
  unclassifiedImage,
  type ImageCategory,
  type ImageClassification,
} from "../images";
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
export const dailyReminders = pgTable("daily_reminders", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  preferences: jsonb("preferences")
    .$type<import("../reminders").ReminderPreferences>()
    .notNull(),
  subscription:
    jsonb("subscription").$type<import("web-push").PushSubscription>(),
  endpoint: text("endpoint").unique(),
  lastDate: date("last_date"),
  lastStatus: text("last_status"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const healthConnections = pgTable("health_connections", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
  lastDate: date("last_date"),
  lastResult: text("last_result"),
});
export const healthImportReceipts = pgTable(
  "health_import_receipts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    date: date("sleep_date").notNull(),
    digest: text("digest").notNull(),
    hours: numeric("hours").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);
// One row per Apple Health workout the iPhone app has offered. It remembers
// which cardio entry the workout became, so a re-delivered workout is not
// logged twice and an entry the athlete edited or deleted stays that way.
export const healthWorkoutImports = pgTable(
  "health_workout_imports",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workoutId: text("workout_id").notNull(),
    cardioId: text("cardio_id"),
    // "imported", "matched" (enriched a manual entry) or "removed".
    status: text("status").notNull(),
    digest: text("digest").notNull(),
    entryDigest: text("entry_digest"),
    importedAt: timestamp("imported_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.workoutId] })],
);
// The GPS track Apple Health recorded for an imported workout, simplified on
// the phone, with place names looked up on the phone. Kept out of the journal
// document so every journal read and save stays small.
export const healthWorkoutRoutes = pgTable(
  "health_workout_routes",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workoutId: text("workout_id").notNull(),
    cardioId: text("cardio_id").notNull(),
    path: jsonb("path").$type<[number, number][]>().notNull(),
    distanceKm: numeric("distance_km", { mode: "number" }).notNull(),
    startPlace: text("start_place"),
    endPlace: text("end_place"),
    farthestPlace: text("farthest_place"),
    digest: text("digest").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.workoutId] }),
    index("health_workout_routes_cardio_idx").on(t.userId, t.cardioId),
  ],
);
export const foodPhotos = pgTable(
  "food_photos",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    label: text("label").notNull(),
    date: date("meal_date").notNull(),
    bytes: integer("bytes").notNull(),
    digest: text("digest").notNull(),
    data: bytea("data").notNull(),
    category: text("category")
      .$type<ImageCategory>()
      .notNull()
      .default("unclassified"),
    classification: jsonb("classification")
      .$type<ImageClassification>()
      .notNull()
      .default(unclassifiedImage),
    version: integer("version").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index("food_photos_user_date_idx").on(t.userId, t.date),
    index("images_user_category_idx").on(t.userId, t.category),
  ],
);
export const journalInvitations = pgTable(
  "journal_invitations",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "invitation_email_normalized",
      sql`${t.email} = lower(btrim(${t.email})) AND length(${t.email}) <= 254`,
    ),
  ],
);

export const user = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const session = pgTable("auth_sessions", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});
export const account = pgTable(
  "auth_accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    issuer: text("issuer").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("auth_account_issuer_idx").on(t.issuer, t.accountId),
    index("auth_account_user_idx").on(t.userId),
  ],
);
export const verification = pgTable("auth_verifications", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const journals = pgTable("journals", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull().default(0),
  state: jsonb("state").$type<JournalState>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
export const workouts = pgTable(
  "workouts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    trainingDate: date("training_date").notNull(),
    programDayId: text("program_day_id").notNull(),
    snapshot: jsonb("snapshot").$type<Workout>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index("workouts_athlete_date_idx").on(t.userId, t.trainingDate),
  ],
);
export const workoutExercises = pgTable(
  "workout_exercises",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workoutId: text("workout_id").notNull(),
    id: text("id").notNull(),
    exerciseId: text("exercise_id").notNull(),
    position: integer("position").notNull(),
    prescription: jsonb("prescription").$type<Entry["prescribed"]>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.workoutId, t.id] }),
    foreignKey({
      columns: [t.userId, t.workoutId],
      foreignColumns: [workouts.userId, workouts.id],
    }).onDelete("cascade"),
  ],
);
export const workoutSets = pgTable(
  "workout_sets",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    workoutId: text("workout_id").notNull(),
    entryId: text("entry_id").notNull(),
    id: text("id").notNull(),
    position: integer("position").notNull(),
    weight: numeric("weight"),
    reps: integer("reps"),
    rpe: numeric("rpe"),
    result: text("result").notNull(),
    logged: boolean("logged").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.workoutId, t.entryId, t.id] }),
    foreignKey({
      columns: [t.userId, t.workoutId, t.entryId],
      foreignColumns: [
        workoutExercises.userId,
        workoutExercises.workoutId,
        workoutExercises.id,
      ],
    }).onDelete("cascade"),
    check("sets_weight_nonnegative", sql`${t.weight} >= 0`),
    check("sets_reps_nonnegative", sql`${t.reps} >= 0`),
    check("sets_rpe_range", sql`${t.rpe} >= 1 AND ${t.rpe} <= 10`),
    check("sets_result_valid", sql`${t.result} IN ('','success','miss')`),
  ],
);
export const mutations = pgTable(
  "sync_mutations",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    hash: text("hash").notNull(),
    revision: integer("revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.id] })],
);
export const catalog = pgTable("catalog", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  data: jsonb("data").notNull(),
});
export const rateLimits = pgTable("request_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

// Spoken conversations with Coach, kept so Coach can recall them later.
export const voiceCalls = pgTable(
  "voice_calls",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull().default("checkin"),
    transcript: jsonb("transcript")
      .$type<{ role: "you" | "coach"; text: string }[]>()
      .notNull(),
    // The transcript as plain text, for search; the tidied text once there
    // is one.
    content: text("content").notNull(),
    // The same lines with punctuation, casing and clear mishearings fixed
    // (lib/voice-transcript.ts); current while tidiedAt >= updatedAt.
    tidy: jsonb("tidy").$type<{ role: "you" | "coach"; text: string }[]>(),
    tidiedAt: timestamp("tidied_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("voice_calls_user_date_idx").on(t.userId, t.startedAt)],
);

// How often each feature is used: a count per account, feature and day,
// with no content, so the owner can see what's used before polishing or
// cutting it (docs/product-principles.md, lib/feature-use.ts).
export const featureUse = pgTable(
  "feature_use",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    feature: text("feature").notNull(),
    day: date("day").notNull(),
    count: integer("count").notNull().default(1),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.feature, t.day] }),
    index("feature_use_day_idx").on(t.day),
  ],
);

// What each AI call cost, per account: one row per model call, Jev routing
// request, web search or voice connection, with no content (lib/ai-usage.ts).
// A call that is retried is billed again, so it gets another row.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // coach, routing, image-tag, video, transcript-tidy, web-search,
    // coach-picture, voice-gemini or voice-elevenlabs.
    feature: text("feature").notNull(),
    // The Coach turn, image, video, picture or voice call the call was for.
    sourceId: text("source_id"),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costUsd: numeric("cost_usd", { precision: 10, scale: 6, mode: "number" })
      .notNull()
      .default(0),
    // Not reported by the provider for the call: worked out from call
    // minutes and a configured rate, or a call that ended before its cost
    // arrived, at no cost.
    estimated: boolean("estimated").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("ai_usage_user_date_idx").on(t.userId, t.createdAt)],
);

// An account's own value for a usage limit, where it differs from the
// default (lib/usage-limits.ts). Set by the owner; deleted with the account.
export const userLimits = pgTable(
  "user_limits",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // coach-messages-day, spend-day-usd, spend-month-usd, spend-turn-usd or
    // voice-minutes-day.
    key: text("key").notNull(),
    // Messages, US dollars or minutes, as the key says.
    value: numeric("value", {
      precision: 12,
      scale: 4,
      mode: "number",
    }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.key] }),
    check("user_limits_value_nonnegative", sql`${t.value} >= 0`),
  ],
);

export const agentTurns = pgTable(
  "agent_turns",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    photoIds: jsonb("photo_ids").$type<string[]>().notNull().default([]),
    response:
      jsonb("response").$type<import("../coach-visuals").CoachResponse>(),
    // running, done, failed, or limited: refused by a usage limit before
    // any AI call, with the limit's reply (lib/usage-limits.ts).
    status: text("status").notNull().default("running"),
    // When the current attempt began; a "running" turn older than
    // STALE_TURN_MS was cut off and may be retried.
    startedAt: timestamp("started_at", { withTimezone: true }),
    // Timings, token counts and cost of the turn's model calls; no text.
    metrics:
      jsonb("metrics").$type<import("../agent/turn-metrics").TurnMetrics>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("agent_turns_user_date_idx").on(t.userId, t.createdAt)],
);
export const agentProposals = pgTable(
  "agent_proposals",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    turnId: text("turn_id")
      .notNull()
      .references(() => agentTurns.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    before: jsonb("before_state").$type<JournalState>().notNull(),
    after: jsonb("after_state").$type<JournalState>().notNull(),
    preview: jsonb("preview")
      .$type<import("../agent/actions").ActionPreview>()
      .notNull(),
    undoId: text("undo_id").notNull(),
    status: text("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("agent_proposals_user_idx").on(t.userId)],
);

// Pictures of dishes Coach drew for a recipe card (lib/coach-pictures.ts).
// Kept apart from the photo library, so a picture is never a meal's evidence
// and never counts toward the photo quota; it goes with its card's turn when
// the chat is cleared, after 90 days, or with the account. The limits count
// from coach_picture_usage.
export const coachPictures = pgTable(
  "coach_pictures",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    turnId: text("turn_id")
      .notNull()
      .references(() => agentTurns.id, { onDelete: "cascade" }),
    status: text("status")
      .$type<"drawing" | "ready" | "failed">()
      .notNull()
      .default("drawing"),
    // Why a picture failed, as a code (refused, timeout, http_503…).
    reason: text("reason"),
    // A hash of what the model was asked, so the same dish asked for again
    // in a turn (a retried message) shows the picture already drawn.
    promptHash: text("prompt_hash"),
    model: text("model"),
    costUsd: doublePrecision("cost_usd"),
    durationMs: integer("duration_ms"),
    bytes: integer("bytes"),
    // A JPEG, once ready.
    data: bytea("data"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index("coach_pictures_user_date_idx").on(t.userId, t.createdAt),
    // The daily spending ceiling counts every account's pictures.
    index("coach_pictures_date_idx").on(t.createdAt),
    index("coach_pictures_turn_idx").on(t.turnId),
  ],
);

// One row for each picture asked for, kept apart from the picture so the
// limits still count it after the chat is cleared: when, and what it cost,
// never the dish. Rows older than 30 days go as the athlete asks for more,
// and all of them with the account.
export const coachPictureUsage = pgTable(
  "coach_picture_usage",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pictureId: text("picture_id").notNull(),
    costUsd: doublePrecision("cost_usd"),
    // Set once the picture is drawn or has failed.
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.pictureId] }),
    index("coach_picture_usage_user_date_idx").on(t.userId, t.createdAt),
    // The daily spending ceiling counts every account's pictures.
    index("coach_picture_usage_date_idx").on(t.createdAt),
  ],
);

export const liftingVideos = pgTable(
  "lifting_videos",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    input: jsonb("input")
      .$type<import("../video/types").VideoUpload>()
      .notNull(),
    digest: text("digest").notNull(),
    bytes: integer("bytes").notNull(),
    source: bytea("source"),
    media: bytea("media"),
    frames: jsonb("frames").$type<string[]>(),
    refinement:
      jsonb("refinement").$type<
        import("../video/checkpoint").VideoRefinementCheckpoint
      >(),
    analysis: jsonb("analysis").$type<import("../video/types").VideoAnalysis>(),
    feedback: text("feedback"),
    status: text("status").notNull().default("queued"),
    stage: text("stage").notNull().default("Waiting to analyse"),
    progress:
      jsonb("progress").$type<import("../video/progress").VideoProgress>(),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    lease: text("lease"),
    leaseUntil: timestamp("lease_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.id] }),
    index("lifting_videos_queue_idx").on(t.status, t.createdAt),
  ],
);
