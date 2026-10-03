ALTER TABLE "agent_proposals" ADD COLUMN IF NOT EXISTS "requested" jsonb;--> statement-breakpoint
ALTER TABLE "food_photos" ADD COLUMN IF NOT EXISTS "tag_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "food_photos" ADD COLUMN IF NOT EXISTS "tag_started_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_turns_running_idx" ON "agent_turns" USING btree ("created_at") WHERE status = 'running';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "images_tag_pending_idx" ON "food_photos" USING btree ("created_at") WHERE classification->>'status' = 'pending';