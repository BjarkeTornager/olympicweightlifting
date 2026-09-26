CREATE TABLE "voice_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"purpose" text DEFAULT 'checkin' NOT NULL,
	"transcript" jsonb NOT NULL,
	"content" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_calls_user_date_idx" ON "voice_calls" USING btree ("user_id","started_at");