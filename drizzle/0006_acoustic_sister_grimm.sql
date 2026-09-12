CREATE TABLE "lifting_videos" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"input" jsonb NOT NULL,
	"digest" text NOT NULL,
	"bytes" integer NOT NULL,
	"source" "bytea",
	"media" "bytea",
	"frames" jsonb,
	"analysis" jsonb,
	"feedback" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'Waiting to analyse' NOT NULL,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease" text,
	"lease_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lifting_videos_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "lifting_videos" ADD CONSTRAINT "lifting_videos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lifting_videos_queue_idx" ON "lifting_videos" USING btree ("status","created_at");