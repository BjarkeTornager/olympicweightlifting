CREATE TABLE IF NOT EXISTS "agent_turn_events" (
	"turn_id" text NOT NULL,
	"seq" integer NOT NULL,
	"attempt" integer NOT NULL,
	"event" json NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_turn_events_turn_id_seq_pk" PRIMARY KEY("turn_id","seq"),
	CONSTRAINT "agent_turn_events_turn_id_agent_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."agent_turns"("id") ON DELETE cascade ON UPDATE no action
);
--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN IF NOT EXISTS "seq" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "agent_turns_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN IF NOT EXISTS "attempt" integer DEFAULT 1 NOT NULL;