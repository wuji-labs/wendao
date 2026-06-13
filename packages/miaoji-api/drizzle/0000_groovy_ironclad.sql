CREATE TYPE "public"."collaborator_role" AS ENUM('VIEWER', 'COMMENTER', 'EDITOR', 'MANAGER');--> statement-breakpoint
CREATE TYPE "public"."job_stage" AS ENUM('TRANSCODE', 'ASR', 'DIARIZE', 'SEGMENT', 'SUMMARIZE', 'INDEX');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('PENDING', 'RUNNING', 'DONE', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."lang" AS ENUM('zh', 'en', 'ja');--> statement-breakpoint
CREATE TYPE "public"."link_scope" AS ENUM('CLOSED', 'TENANT_VIEW', 'TENANT_EDIT', 'ANYONE_VIEW');--> statement-breakpoint
CREATE TYPE "public"."media_type" AS ENUM('AUDIO', 'VIDEO');--> statement-breakpoint
CREATE TYPE "public"."minute_source" AS ENUM('MEETING', 'UPLOAD', 'CLOUD', 'MOBILE_RECORD');--> statement-breakpoint
CREATE TYPE "public"."minute_status" AS ENUM('UPLOADING', 'TRANSCODING', 'TRANSCRIBING', 'DIARIZING', 'SEGMENTING', 'SUMMARIZING', 'READY', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."qa_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."subject_type" AS ENUM('MINUTE', 'FOLDER', 'CLIP');--> statement-breakpoint
CREATE TYPE "public"."todo_status" AS ENUM('OPEN', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "chapters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minute_id" uuid NOT NULL,
	"title" varchar(256) NOT NULL,
	"start_ms" bigint NOT NULL,
	"end_ms" bigint NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"order_index" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minute_id" uuid NOT NULL,
	"start_ms" bigint NOT NULL,
	"end_ms" bigint NOT NULL,
	"title" varchar(256) DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"share_token" varchar(32) NOT NULL,
	"link_scope" "link_scope" DEFAULT 'CLOSED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clips_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "collaborators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" "subject_type" NOT NULL,
	"subject_id" uuid NOT NULL,
	"principal_id" uuid NOT NULL,
	"role" "collaborator_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minute_id" uuid NOT NULL,
	"segment_id" uuid,
	"char_start" integer,
	"char_end" integer,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"parent_id" uuid,
	"resolved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(128) NOT NULL,
	"owner_id" uuid NOT NULL,
	"parent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "highlights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minute_id" uuid NOT NULL,
	"segment_id" uuid NOT NULL,
	"char_start" integer NOT NULL,
	"char_end" integer NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minute_id" uuid NOT NULL,
	"stage" "job_stage" NOT NULL,
	"status" "job_status" DEFAULT 'PENDING' NOT NULL,
	"progress" double precision DEFAULT 0 NOT NULL,
	"error_message" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "minutes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" varchar(32) NOT NULL,
	"owner_id" uuid NOT NULL,
	"folder_id" uuid,
	"title" varchar(256) DEFAULT '' NOT NULL,
	"cover" varchar(1024),
	"source" "minute_source" DEFAULT 'UPLOAD' NOT NULL,
	"media_type" "media_type" NOT NULL,
	"media_key" varchar(1024),
	"playable_key" varchar(1024),
	"duration_ms" bigint DEFAULT 0 NOT NULL,
	"language" "lang" DEFAULT 'zh' NOT NULL,
	"status" "minute_status" DEFAULT 'UPLOADING' NOT NULL,
	"error_message" text,
	"visitor_count" integer DEFAULT 0 NOT NULL,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"comment_count" integer DEFAULT 0 NOT NULL,
	"quota_minutes" integer DEFAULT 0 NOT NULL,
	"link_scope" "link_scope" DEFAULT 'CLOSED' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "minutes_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qa_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"role" "qa_role" NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "qa_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minute_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "segments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minute_id" uuid NOT NULL,
	"speaker_id" uuid,
	"start_ms" bigint NOT NULL,
	"end_ms" bigint NOT NULL,
	"text" text DEFAULT '' NOT NULL,
	"words" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"order_index" integer NOT NULL,
	"paragraph_id" varchar(64),
	"is_edited" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "speakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minute_id" uuid NOT NULL,
	"display_name" varchar(64) NOT NULL,
	"voiceprint_key" varchar(64),
	"is_renamed" boolean DEFAULT false NOT NULL,
	"total_speaking_ms" bigint DEFAULT 0 NOT NULL,
	"segment_count" integer DEFAULT 0 NOT NULL,
	"word_count" integer DEFAULT 0 NOT NULL,
	"speaking_ratio" double precision DEFAULT 0 NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"color_hex" varchar(7)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minute_id" uuid NOT NULL,
	"overview" text DEFAULT '' NOT NULL,
	"key_points" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'PENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "summaries_minute_id_unique" UNIQUE("minute_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "todos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"minute_id" uuid NOT NULL,
	"text" text NOT NULL,
	"owner" varchar(64),
	"source_segment_id" uuid,
	"status" "todo_status" DEFAULT 'OPEN' NOT NULL,
	"external_task_id" varchar(128),
	"order_index" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "translations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"segment_id" uuid NOT NULL,
	"target_lang" "lang" NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(64) NOT NULL,
	"email" varchar(256),
	"avatar_url" varchar(1024),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chapters_minute_idx" ON "chapters" USING btree ("minute_id","order_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clips_minute_idx" ON "clips" USING btree ("minute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "collaborators_subject_idx" ON "collaborators" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "collaborators_subject_principal_idx" ON "collaborators" USING btree ("subject_type","subject_id","principal_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_minute_idx" ON "comments" USING btree ("minute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_segment_idx" ON "comments" USING btree ("segment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folders_owner_idx" ON "folders" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "folders_parent_idx" ON "folders" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "highlights_minute_idx" ON "highlights" USING btree ("minute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_minute_stage_idx" ON "jobs" USING btree ("minute_id","stage");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "minutes_owner_idx" ON "minutes" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "minutes_folder_idx" ON "minutes" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "minutes_status_idx" ON "minutes" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qa_messages_thread_idx" ON "qa_messages" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "qa_threads_minute_idx" ON "qa_threads" USING btree ("minute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "segments_minute_order_idx" ON "segments" USING btree ("minute_id","order_index");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "segments_speaker_idx" ON "segments" USING btree ("speaker_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "speakers_minute_idx" ON "speakers" USING btree ("minute_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "todos_minute_idx" ON "todos" USING btree ("minute_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "translations_seg_lang_idx" ON "translations" USING btree ("segment_id","target_lang");