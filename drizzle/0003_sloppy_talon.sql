CREATE TABLE "food_photos" (
	"user_id" text NOT NULL,
	"id" text NOT NULL,
	"label" text NOT NULL,
	"meal_date" date NOT NULL,
	"bytes" integer NOT NULL,
	"digest" text NOT NULL,
	"data" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "food_photos_user_id_id_pk" PRIMARY KEY("user_id","id")
);
--> statement-breakpoint
ALTER TABLE "agent_turns" ADD COLUMN "photo_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "food_photos" ADD CONSTRAINT "food_photos_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "food_photos_user_date_idx" ON "food_photos" USING btree ("user_id","meal_date");