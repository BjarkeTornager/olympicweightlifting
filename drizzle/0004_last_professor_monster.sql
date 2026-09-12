ALTER TABLE "food_photos" ADD COLUMN "category" text DEFAULT 'unclassified' NOT NULL;--> statement-breakpoint
ALTER TABLE "food_photos" ADD COLUMN "classification" jsonb DEFAULT '{"tags":[],"confidence":"low","source":"legacy","status":"review"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "food_photos" ADD COLUMN "version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "images_user_category_idx" ON "food_photos" USING btree ("user_id","category");--> statement-breakpoint
-- Preserve explicit existing meal links without sending archived images to a provider.
-- Unlinked legacy uploads remain unclassified for category review.
UPDATE "food_photos" AS image SET "category" = 'food'
WHERE EXISTS (
  SELECT 1 FROM "journals" AS journal,
    jsonb_array_elements(COALESCE(journal.state->'nutrition'->'meals', '[]'::jsonb)) AS meal
  WHERE journal.user_id = image.user_id AND (meal->'photoIds') ? image.id
);
