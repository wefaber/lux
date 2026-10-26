ALTER TABLE "users" ADD COLUMN "student_group" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "student_shift" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "student_subjects" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "users_student_idx" ON "users" USING btree ("student_group","student_shift");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_student_shift_check" CHECK ("users"."student_shift" is null or "users"."student_shift" in ('matutino', 'vespertino', 'nocturno'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_student_subjects_check" CHECK (jsonb_typeof("users"."student_subjects") = 'array');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_student_info_check" CHECK ("users"."role" = 'solicitante' or ("users"."student_group" is null and "users"."student_shift" is null and "users"."student_subjects" = '[]'::jsonb));
