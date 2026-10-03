CREATE TABLE "coach_pictures" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"turn_id" text NOT NULL,
	"status" text DEFAULT 'drawing' NOT NULL,
	"reason" text,
	"model" text,
	"cost_usd" double precision,
	"duration_ms" integer,
	"bytes" integer,
	"data" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_pictures_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "coach_pictures" ADD CONSTRAINT "coach_pictures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coach_pictures" ADD CONSTRAINT "coach_pictures_turn_id_agent_turns_id_fk" FOREIGN KEY ("turn_id") REFERENCES "public"."agent_turns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_pictures_user_date_idx" ON "coach_pictures" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "coach_pictures_date_idx" ON "coach_pictures" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "coach_pictures_turn_idx" ON "coach_pictures" USING btree ("turn_id");