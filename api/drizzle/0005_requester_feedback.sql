ALTER TABLE "tickets" ADD COLUMN "attended_at" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "rated_at" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_rating_check" CHECK ("tickets"."rating" is null or "tickets"."rating" between 1 and 5);