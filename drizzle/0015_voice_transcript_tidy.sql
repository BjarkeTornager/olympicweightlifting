ALTER TABLE "voice_calls" ADD COLUMN "tidy" jsonb;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD COLUMN "tidied_at" timestamp with time zone;