CREATE TABLE "daily_reminders" (
	"user_id" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"preferences" jsonb NOT NULL,
	"subscription" jsonb,
	"endpoint" text,
	"last_date" date,
	"last_status" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_reminders_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "health_connections" (
	"user_id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_date" date,
	"last_result" text,
	CONSTRAINT "health_connections_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "health_import_receipts" (
	"user_id" text NOT NULL,
	"sleep_date" date NOT NULL,
	"digest" text NOT NULL,
	"hours" numeric NOT NULL,
	CONSTRAINT "health_import_receipts_user_id_sleep_date_pk" PRIMARY KEY("user_id","sleep_date")
);
--> statement-breakpoint
ALTER TABLE "daily_reminders" ADD CONSTRAINT "daily_reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_connections" ADD CONSTRAINT "health_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "health_import_receipts" ADD CONSTRAINT "health_import_receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;