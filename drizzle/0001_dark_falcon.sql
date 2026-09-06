ALTER TABLE "workouts" ALTER COLUMN "training_date" SET DATA TYPE date USING "training_date"::date;--> statement-breakpoint
ALTER TABLE "auth_accounts" ADD COLUMN "issuer" text NOT NULL;--> statement-breakpoint
ALTER TABLE "workout_exercises" ADD CONSTRAINT "workout_exercises_user_id_workout_id_workouts_user_id_id_fk" FOREIGN KEY ("user_id","workout_id") REFERENCES "public"."workouts"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "workout_sets_user_id_workout_id_entry_id_workout_exercises_user_id_workout_id_id_fk" FOREIGN KEY ("user_id","workout_id","entry_id") REFERENCES "public"."workout_exercises"("user_id","workout_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "auth_account_issuer_idx" ON "auth_accounts" USING btree ("issuer","account_id");--> statement-breakpoint
CREATE INDEX "auth_account_user_idx" ON "auth_accounts" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "sets_weight_nonnegative" CHECK ("workout_sets"."weight" >= 0);--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "sets_reps_nonnegative" CHECK ("workout_sets"."reps" >= 0);--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "sets_rpe_range" CHECK ("workout_sets"."rpe" >= 1 AND "workout_sets"."rpe" <= 10);--> statement-breakpoint
ALTER TABLE "workout_sets" ADD CONSTRAINT "sets_result_valid" CHECK ("workout_sets"."result" IN ('','success','miss'));