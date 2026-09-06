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
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { JournalState, Workout, Entry } from "../model";
import {
  unclassifiedImage,
  type ImageCategory,
  type ImageClassification,
} from "../images";
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
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
    status: text("status").notNull().default("running"),
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
