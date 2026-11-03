CREATE TABLE "class_schedules" (
	"id" text PRIMARY KEY NOT NULL,
	"location_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"weekday" integer NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"subject" text,
	"student_group" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	CONSTRAINT "class_schedules_weekday_check" CHECK ("class_schedules"."weekday" between 1 and 7),
	CONSTRAINT "class_schedules_time_check" CHECK ("class_schedules"."start_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "class_schedules"."end_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and "class_schedules"."start_time" < "class_schedules"."end_time")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_teacher" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "class_schedules_location_idx" ON "class_schedules" USING btree ("location_id","weekday");--> statement-breakpoint
CREATE INDEX "class_schedules_teacher_idx" ON "class_schedules" USING btree ("teacher_id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_teacher_role_check" CHECK (not "users"."is_teacher" or "users"."role" = 'solicitante');