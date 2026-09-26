CREATE TABLE "health_workout_routes" (
	"user_id" text NOT NULL,
	"workout_id" text NOT NULL,
	"cardio_id" text NOT NULL,
	"path" jsonb NOT NULL,
	"distance_km" numeric NOT NULL,
	"start_place" text,
	"end_place" text,
	"farthest_place" text,
	"digest" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_workout_routes_user_id_workout_id_pk" PRIMARY KEY("user_id","workout_id")
);
--> statement-breakpoint
ALTER TABLE "health_workout_routes" ADD CONSTRAINT "health_workout_routes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_workout_routes_cardio_idx" ON "health_workout_routes" USING btree ("user_id","cardio_id");