CREATE TABLE "feature_use" (
	"user_id" text NOT NULL,
	"feature" text NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "feature_use_user_id_feature_day_pk" PRIMARY KEY("user_id","feature","day")
);
--> statement-breakpoint
ALTER TABLE "feature_use" ADD CONSTRAINT "feature_use_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "feature_use_day_idx" ON "feature_use" USING btree ("day");