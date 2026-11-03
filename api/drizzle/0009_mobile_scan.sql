CREATE TABLE "equipment_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"author_id" text NOT NULL,
	"product_id" text NOT NULL,
	"body" text NOT NULL,
	"client_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "equipment_notes_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
CREATE TABLE "incident_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"priority" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"author_id" text NOT NULL,
	"approved_by_id" text,
	"approved_at" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text,
	CONSTRAINT "incident_templates_category_check" CHECK ("incident_templates"."category" in ('hardware', 'software', 'network', 'other')),
	CONSTRAINT "incident_templates_priority_check" CHECK ("incident_templates"."priority" in ('low', 'medium', 'high', 'critical')),
	CONSTRAINT "incident_templates_status_check" CHECK ("incident_templates"."status" in ('draft', 'testing', 'approved', 'retired'))
);
--> statement-breakpoint
CREATE TABLE "scan_events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"product_id" text,
	"machine_id" text NOT NULL,
	"context" text NOT NULL,
	"user_agent" text,
	"client_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "scan_events_client_id_unique" UNIQUE("client_id"),
	CONSTRAINT "scan_events_context_check" CHECK ("scan_events"."context" in ('inventory', 'incident', 'loan'))
);
--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "priority" text DEFAULT 'medium' NOT NULL;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "location_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "template_id" text;--> statement-breakpoint
ALTER TABLE "tickets" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "equipment_notes" ADD CONSTRAINT "equipment_notes_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "equipment_notes" ADD CONSTRAINT "equipment_notes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_templates" ADD CONSTRAINT "incident_templates_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_templates" ADD CONSTRAINT "incident_templates_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_events" ADD CONSTRAINT "scan_events_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "equipment_notes_author_product_idx" ON "equipment_notes" USING btree ("author_id","product_id");--> statement-breakpoint
CREATE INDEX "incident_templates_status_idx" ON "incident_templates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scan_events_product_idx" ON "scan_events" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "scan_events_user_idx" ON "scan_events" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_template_id_incident_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."incident_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tickets_location_idx" ON "tickets" USING btree ("location_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_client_id_unique" UNIQUE("client_id");--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_priority_check" CHECK ("tickets"."priority" in ('low', 'medium', 'high', 'critical'));--> statement-breakpoint
-- Tickets existentes: la ubicacion sale del equipo asociado
UPDATE "tickets" SET "location_id" = "products"."location_id" FROM "products" WHERE "tickets"."equipment_id" = "products"."id" AND "tickets"."location_id" IS NULL;
