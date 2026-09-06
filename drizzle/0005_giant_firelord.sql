CREATE TABLE "journal_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "journal_invitations_email_unique" UNIQUE("email"),
	CONSTRAINT "invitation_email_normalized" CHECK ("journal_invitations"."email" = lower(btrim("journal_invitations"."email")) AND length("journal_invitations"."email") <= 254)
);
--> statement-breakpoint
ALTER TABLE "journal_invitations" ADD CONSTRAINT "journal_invitations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;