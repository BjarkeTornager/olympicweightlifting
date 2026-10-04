ALTER TABLE "health_workout_imports" ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "health_workout_imports" ADD COLUMN IF NOT EXISTS "ended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "health_workout_imports" ADD COLUMN IF NOT EXISTS "workout" jsonb;