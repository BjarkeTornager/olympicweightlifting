CREATE TABLE "coach_picture_usage" (
	"user_id" text NOT NULL,
	"picture_id" text NOT NULL,
	"cost_usd" double precision,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "coach_picture_usage_user_id_picture_id_pk" PRIMARY KEY("user_id","picture_id")
);
--> statement-breakpoint
ALTER TABLE "coach_pictures" ADD COLUMN "prompt_hash" text;--> statement-breakpoint
ALTER TABLE "coach_picture_usage" ADD CONSTRAINT "coach_picture_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "coach_picture_usage_user_date_idx" ON "coach_picture_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "coach_picture_usage_date_idx" ON "coach_picture_usage" USING btree ("created_at");--> statement-breakpoint
-- Pictures asked for before their use was kept apart from them.
INSERT INTO "coach_picture_usage" ("user_id", "picture_id", "cost_usd", "finished_at", "created_at") SELECT "user_id", "id", "cost_usd", CASE WHEN "status" <> 'drawing' THEN "updated_at" END, "created_at" FROM "coach_pictures" ON CONFLICT DO NOTHING;
