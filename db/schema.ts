import { pgTable, serial, text, timestamp, integer, uuid, boolean } from "drizzle-orm/pg-core";

// One row per chat session. Created the first time a recommendation is made.
export const chatSessions = pgTable("chat_sessions", {
  id: uuid().primaryKey(),
  usedViewingHistory: boolean("used_viewing_history").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// One row every time the API returns a set of recommendations.
export const recommendationEvents = pgTable("recommendation_events", {
  id: serial().primaryKey(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  feedback: text().notNull().default(""),
  intro: text().notNull().default(""),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// The answers the user had given at the time of a recommendation event.
export const userAnswers = pgTable("user_answers", {
  id: serial().primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => recommendationEvents.id, { onDelete: "cascade" }),
  position: integer().notNull(),
  question: text().notNull(),
  answer: text().notNull(),
});

// The individual titles recommended in a recommendation event.
export const recommendations = pgTable("recommendations", {
  id: serial().primaryKey(),
  eventId: integer("event_id")
    .notNull()
    .references(() => recommendationEvents.id, { onDelete: "cascade" }),
  position: integer().notNull(),
  title: text().notNull(),
  type: text().notNull().default(""),
  genres: text().notNull().default(""),
  why: text().notNull().default(""),
  match: text().notNull().default(""),
  availabilityNote: text("availability_note").notNull().default(""),
});
