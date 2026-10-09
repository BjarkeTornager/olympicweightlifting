CREATE TABLE IF NOT EXISTS "voice_conversations" (
	"conversation_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"call_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action
);
