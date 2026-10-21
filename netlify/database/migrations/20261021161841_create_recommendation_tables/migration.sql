CREATE TABLE "chat_sessions" (
	"id" uuid PRIMARY KEY,
	"used_viewing_history" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendation_events" (
	"id" serial PRIMARY KEY,
	"session_id" uuid NOT NULL,
	"feedback" text DEFAULT '' NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" serial PRIMARY KEY,
	"event_id" integer NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"type" text DEFAULT '' NOT NULL,
	"genres" text DEFAULT '' NOT NULL,
	"why" text DEFAULT '' NOT NULL,
	"match" text DEFAULT '' NOT NULL,
	"availability_note" text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_answers" (
	"id" serial PRIMARY KEY,
	"event_id" integer NOT NULL,
	"position" integer NOT NULL,
	"question" text NOT NULL,
	"answer" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "recommendation_events" ADD CONSTRAINT "recommendation_events_session_id_chat_sessions_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_sessions"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_event_id_recommendation_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "recommendation_events"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_answers" ADD CONSTRAINT "user_answers_event_id_recommendation_events_id_fkey" FOREIGN KEY ("event_id") REFERENCES "recommendation_events"("id") ON DELETE CASCADE;