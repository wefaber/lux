CREATE TABLE "activity_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"user_name" text NOT NULL,
	"operation" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"timestamp" text NOT NULL,
	"details" text
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "components" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"model" text NOT NULL,
	"manufacturer" text NOT NULL,
	"serial_number" text NOT NULL,
	"part_number" text NOT NULL,
	"is_factory" boolean NOT NULL,
	"is_working" boolean NOT NULL,
	"product_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "interventions" (
	"id" text PRIMARY KEY NOT NULL,
	"equipment_id" text NOT NULL,
	"technician_id" text NOT NULL,
	"type" text NOT NULL,
	"description" text NOT NULL,
	"parts_replaced" text,
	"ticket_id" text,
	"performed_at" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loan_components" (
	"loan_id" text NOT NULL,
	"component_id" text NOT NULL,
	CONSTRAINT "loan_components_loan_id_component_id_pk" PRIMARY KEY("loan_id","component_id")
);
--> statement-breakpoint
CREATE TABLE "loans" (
	"id" text PRIMARY KEY NOT NULL,
	"equipment_id" text NOT NULL,
	"user_id" text NOT NULL,
	"status" text NOT NULL,
	"approved_by_id" text,
	"delivered_by_id" text,
	"delivered_at" text,
	"issue_date" text NOT NULL,
	"return_date" text NOT NULL,
	"actual_return_date" text,
	"rejection_reason" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"number" integer NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" text NOT NULL,
	"kind" text NOT NULL,
	"by_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_seen" (
	"user_id" text NOT NULL,
	"section" text NOT NULL,
	"seen_at" text NOT NULL,
	CONSTRAINT "pending_seen_user_id_section_pk" PRIMARY KEY("user_id","section")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" text PRIMARY KEY NOT NULL,
	"machine_id" text NOT NULL,
	"kind" text NOT NULL,
	"brand" text NOT NULL,
	"model" text NOT NULL,
	"serial_number" text NOT NULL,
	"part_number" text NOT NULL,
	"status" text NOT NULL,
	"issues" text,
	"location_id" text NOT NULL,
	"location" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"resource_type" text NOT NULL,
	"equipment_id" text,
	"location_id" text,
	"user_id" text NOT NULL,
	"purpose" text NOT NULL,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"status" text NOT NULL,
	"reviewed_by_id" text,
	"rejection_reason" text,
	"cancelled_by_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"assigned_to_id" text,
	"description" text NOT NULL,
	"lab_number" text,
	"software_name" text,
	"equipment_id" text,
	"resolution_text" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"status" text NOT NULL,
	"submitted_by_id" text NOT NULL,
	"assigned_to_id" text,
	"equipment_id" text,
	"diagnosis" text,
	"corrected" boolean,
	"actions_taken" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"resolved_at" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"dni" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "users_dni_unique" UNIQUE("dni")
);
--> statement-breakpoint
CREATE INDEX "comments_entity_idx" ON "comments" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "components_product_idx" ON "components" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "interventions_equipment_idx" ON "interventions" USING btree ("equipment_id");--> statement-breakpoint
CREATE INDEX "loans_user_idx" ON "loans" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "loans_status_idx" ON "loans" USING btree ("status");--> statement-breakpoint
CREATE INDEX "locations_code_idx" ON "locations" USING btree ("code");--> statement-breakpoint
CREATE INDEX "notices_user_idx" ON "notices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "products_location_idx" ON "products" USING btree ("location_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");--> statement-breakpoint
CREATE INDEX "reservations_user_idx" ON "reservations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "reservations_status_idx" ON "reservations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "services_status_idx" ON "service_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tickets_submitted_by_idx" ON "tickets" USING btree ("submitted_by_id");--> statement-breakpoint
CREATE INDEX "tickets_assigned_to_idx" ON "tickets" USING btree ("assigned_to_id");