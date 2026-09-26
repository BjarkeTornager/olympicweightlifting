CREATE TABLE "health_workout_imports" (
	"user_id" text NOT NULL,
	"workout_id" text NOT NULL,
	"cardio_id" text,
	"status" text NOT NULL,
	"digest" text NOT NULL,
	"entry_digest" text,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "health_workout_imports_user_id_workout_id_pk" PRIMARY KEY("user_id","workout_id")
);
--> statement-breakpoint
ALTER TABLE "health_workout_imports" ADD CONSTRAINT "health_workout_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;