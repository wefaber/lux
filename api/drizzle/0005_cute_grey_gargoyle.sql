CREATE TABLE "error_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"route" text NOT NULL,
	"user_agent" text,
	"role" text,
	"first_seen" text NOT NULL,
	"last_seen" text NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"github_issue_url" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "error_reports_fingerprint_unique" UNIQUE("fingerprint"),
	CONSTRAINT "error_reports_status_check" CHECK ("error_reports"."status" in ('new', 'triaged', 'resolved'))
);
--> statement-breakpoint
CREATE INDEX "error_reports_status_idx" ON "error_reports" USING btree ("status");--> statement-breakpoint
CREATE INDEX "error_reports_last_seen_idx" ON "error_reports" USING btree ("last_seen");