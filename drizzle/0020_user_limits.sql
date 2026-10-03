CREATE TABLE "user_limits" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" numeric(12, 4) NOT NULL,
	CONSTRAINT "user_limits_user_id_key_pk" PRIMARY KEY("user_id","key"),
	CONSTRAINT "user_limits_value_nonnegative" CHECK ("user_limits"."value" >= 0)
);
--> statement-breakpoint
ALTER TABLE "user_limits" ADD CONSTRAINT "user_limits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;