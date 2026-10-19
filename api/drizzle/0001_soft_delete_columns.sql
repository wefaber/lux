ALTER TABLE "comments" ADD COLUMN "deleted_at" text;--> statement-breakpoint
ALTER TABLE "interventions" ADD COLUMN "deleted_at" text;--> statement-breakpoint
ALTER TABLE "loans" ADD COLUMN "deleted_at" text;--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "deleted_at" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "deleted_at" text;