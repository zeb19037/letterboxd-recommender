import { randomUUID } from "node:crypto";
import { db } from "./index.js";
import {
  chatSessions,
  recommendationEvents,
  userAnswers,
  recommendations,
} from "./schema.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Answer = { question: string; answer: string };

type Recommendation = {
  title?: unknown;
  type?: unknown;
  genres?: unknown;
  why?: unknown;
  match?: unknown;
  availabilityNote?: unknown;
};

const text = (value: unknown, maxLength = 2000) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";

// Stores one recommendation event: the session it belongs to, the answers the
// user gave, and every title the chatbot recommended.
export async function saveRecommendation({
  sessionId,
  usedViewingHistory,
  answers,
  feedback,
  result,
}: {
  sessionId: unknown;
  usedViewingHistory: boolean;
  answers: Answer[];
  feedback: string;
  result: { intro?: unknown; recommendations?: unknown };
}) {
  const items = Array.isArray(result.recommendations)
    ? (result.recommendations as Recommendation[]).filter((item) => text(item?.title))
    : [];

  if (!items.length) return;

  const id =
    typeof sessionId === "string" && UUID_PATTERN.test(sessionId)
      ? sessionId
      : randomUUID();

  await db
    .insert(chatSessions)
    .values({ id, usedViewingHistory })
    .onConflictDoNothing();

  const [event] = await db
    .insert(recommendationEvents)
    .values({ sessionId: id, feedback, intro: text(result.intro) })
    .returning({ id: recommendationEvents.id });

  if (answers.length) {
    await db.insert(userAnswers).values(
      answers.map((item, index) => ({
        eventId: event.id,
        position: index + 1,
        question: item.question,
        answer: item.answer,
      }))
    );
  }

  await db.insert(recommendations).values(
    items.map((item, index) => ({
      eventId: event.id,
      position: index + 1,
      title: text(item.title, 300),
      type: text(item.type, 100),
      genres: text(item.genres, 300),
      why: text(item.why),
      match: text(item.match, 300),
      availabilityNote: text(item.availabilityNote, 500),
    }))
  );
}
