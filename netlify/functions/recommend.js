
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import pg from "pg";

const { Pool } = pg;

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const COOKIE_NAME = "netty_identity";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const PROFILE_KEYS = [
  "favoriteFilms",
  "favoriteDirectors",
  "preferredGenres",
  "avoidedGenres",
  "preferredThemes",
  "preferredMoods",
  "contentBoundaries",
  "seenFilms",
  "dislikedRecommendations"
];

const PROFILE_CATEGORY = {
  favoriteFilms: "liked_film",
  favoriteDirectors: "director",
  preferredGenres: "genre",
  avoidedGenres: "genre",
  preferredThemes: "preference",
  preferredMoods: "mood",
  contentBoundaries: "preference",
  seenFilms: "watched_film",
  dislikedRecommendations: "disliked_film"
};

let pool;

function getPool() {
  const connectionString =
    process.env.NETLIFY_DB_URL || process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "Database connection is missing. Configure NETLIFY_DB_URL in Netlify."
    );
  }

  if (!pool) {
    pool = new Pool({
      connectionString,
      max: 3,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 5000
    });
  }

  return pool;
}

function json(status, data, cookie) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });

  if (cookie) {
    headers.set("Set-Cookie", cookie);
  }

  return new Response(JSON.stringify(data), { status, headers });
}

function cleanText(value, maxLength = 2000) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cleanList(value) {
  if (!Array.isArray(value)) return [];

  return value
    .slice(0, 30)
    .map((item) => cleanText(item, 150))
    .filter(Boolean);
}

function emptyProfile() {
  return Object.fromEntries(PROFILE_KEYS.map((key) => [key, []]));
}

function cleanProfile(value) {
  const profile =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};

  return Object.fromEntries(
    PROFILE_KEYS.map((key) => [key, cleanList(profile[key])])
  );
}

function mergeProfiles(existing, updates) {
  const merged = cleanProfile(existing);
  const cleanUpdates = cleanProfile(updates);

  for (const key of PROFILE_KEYS) {
    const known = new Set(
      merged[key].map((item) => item.toLocaleLowerCase())
    );

    for (const item of cleanUpdates[key]) {
      const normalized = item.toLocaleLowerCase();

      if (!known.has(normalized)) {
        merged[key].push(item);
        known.add(normalized);
      }
    }
  }

  return merged;
}

function cleanMessages(value) {
  if (!Array.isArray(value)) return [];

  return value
    .slice(-24)
    .map((message) => {
      if (!message || typeof message !== "object") return null;

      if (
        message.role !== "user" &&
        message.role !== "assistant"
      ) {
        return null;
      }

      const text = cleanText(message.text, 2000);
      if (!text) return null;

      return { role: message.role, text };
    })
    .filter(Boolean);
}

function cookieSecret() {
  const secret = process.env.ANONYMOUS_USER_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      "ANONYMOUS_USER_SECRET must be configured with at least 32 characters."
    );
  }

  return secret;
}

function signIdentity(userId, sessionId) {
  const payload = `${userId}.${sessionId}`;

  return createHmac("sha256", cookieSecret())
    .update(payload)
    .digest("hex");
}

function makeIdentityCookie(userId, sessionId) {
  const signature = signIdentity(userId, sessionId);
  const value = `${userId}.${sessionId}.${signature}`;

  const isLocalDevelopment =
    process.env.NETLIFY_DEV === "true" ||
    process.env.CONTEXT === "dev" ||
    process.env.NODE_ENV === "development";

  return [
    `${COOKIE_NAME}=${value}`,
    "Path=/",
    `Max-Age=${COOKIE_MAX_AGE}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(isLocalDevelopment ? [] : ["Secure"])
  ].join("; ");
}

function readIdentityCookie(request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const entry = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));

  if (!entry) return null;

  const value = entry.slice(COOKIE_NAME.length + 1);
  const parts = value.split(".");

  if (parts.length !== 3) return null;

  const [userId, sessionId, signature] = parts;

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (!uuidPattern.test(userId) || !uuidPattern.test(sessionId)) {
    return null;
  }

  if (!/^[0-9a-f]{64}$/i.test(signature)) {
    return null;
  }

  const expected = Buffer.from(signIdentity(userId, sessionId), "hex");
  const actual = Buffer.from(signature, "hex");

  if (
    actual.length !== expected.length ||
    !timingSafeEqual(actual, expected)
  ) {
    return null;
  }

  return { userId, sessionId };
}

function profileKeyForMemory(memory) {
  const match = /^profileKey:(.+)$/.exec(memory.details || "");

  if (match && PROFILE_KEYS.includes(match[1])) {
    return match[1];
  }

  const fallback = {
    liked_film: "favoriteFilms",
    disliked_film: "dislikedRecommendations",
    director: "favoriteDirectors",
    mood: "preferredMoods",
    watched_film: "seenFilms",
    genre: "preferredGenres",
    preference: "preferredThemes"
  };

  return fallback[memory.category] || null;
}

function profileFromMemories(rows) {
  const profile = emptyProfile();

  for (const memory of rows) {
    const key = profileKeyForMemory(memory);
    if (!key || !memory.subject) continue;

    const normalized = memory.subject.toLocaleLowerCase();

    if (
      !profile[key].some(
        (item) => item.toLocaleLowerCase() === normalized
      )
    ) {
      profile[key].push(memory.subject);
    }
  }

  return profile;
}

function buildPrompt(messages, tasteProfile) {
  return `
You are Netty, an AI-powered film conversation companion.

PURPOSE
Help people talk about films, explore cinema, understand themes,
discuss directors and genres, and discover films they may enjoy.
Recommendations are only one possible outcome.

PERSONALITY
- Friendly, curious, relaxed, and conversational.
- Be concise but useful.
- Use emojis sparingly.
- Never claim to be human or to have personal viewing experiences.
- Do not repeat your introduction during an ongoing conversation.

CONVERSATION
- Respond directly to the latest user message.
- Use previous messages to understand context and follow-up questions.
- Ask a follow-up question only when it would genuinely help.
- Do not turn every conversation into a questionnaire.
- If the user wants to discuss a film, discuss it instead of forcing
  recommendations.
- If the user requests recommendations, suggest 3 to 5 films and
  explain why each might fit their stated tastes.
- Consider films from different countries, decades, and styles.
- Respect films the user has already seen or disliked.
- Do not assume mentioning a film means the user likes it.
- Avoid spoilers unless the user asks for them.
- If the user changes topic, follow the new topic when appropriate.

ACCURACY
- Do not knowingly invent film titles, directors, release years, or facts.
- You do not have guaranteed live access to a film database.
- Be honest when a detail is uncertain.
- Do not claim current streaming availability unless verified.

PRIVACY AND MEMORY
- Respect the user's stated content boundaries.
- Do not ask for passwords, payment details, or unnecessary personal data.
- Treat the taste profile as helpful context, not a complete description
  of the person.
- Only add profile information that the user clearly states.
- Do not infer a strong preference from a casual mention.
- Only suggest profile updates supported by the latest user message.
- Do not treat assistant statements or hypothetical examples as facts
  about the user's preferences.
- Return only new, meaningful profile information.

CURRENT TASTE PROFILE
${JSON.stringify(tasteProfile)}

RECENT CONVERSATION
${JSON.stringify(messages)}

Respond to the latest user message in context.

Return only valid JSON with this structure:
{
  "reply": "Your response to the user",
  "profileUpdates": {
    "favoriteFilms": [],
    "favoriteDirectors": [],
    "preferredGenres": [],
    "avoidedGenres": [],
    "preferredThemes": [],
    "preferredMoods": [],
    "contentBoundaries": [],
    "seenFilms": [],
    "dislikedRecommendations": []
  }
}

Use empty arrays when there is nothing new. Do not repeat items
already in the profile. The reply should answer the user's actual message.
`;
}

function parseGeneratedJSON(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");

  const parsed = JSON.parse(cleaned);

  if (!parsed || typeof parsed.reply !== "string") {
    throw new Error("The AI returned an invalid response.");
  }

  return {
    reply: parsed.reply.trim(),
    profileUpdates: cleanProfile(parsed.profileUpdates)
  };
}

async function getUserAndSession(client, request, firstMessage) {
  const identity = readIdentityCookie(request);

  let userId = identity?.userId || randomUUID();
  let sessionId = identity?.sessionId || randomUUID();

  const userResult = await client.query(
    "SELECT id FROM public.users WHERE id = $1",
    [userId]
  );

  if (userResult.rowCount === 0) {
    await client.query(
      `INSERT INTO public.users (id)
       VALUES ($1)
       ON CONFLICT (id) DO NOTHING`,
      [userId]
    );
  }

  const sessionResult = await client.query(
    `SELECT id
     FROM public.chat_sessions
     WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );

  if (sessionResult.rowCount === 0) {
    sessionId = randomUUID();

    await client.query(
      `INSERT INTO public.chat_sessions (id, user_id, title)
       VALUES ($1, $2, $3)`,
      [sessionId, userId, cleanText(firstMessage, 80) || "New conversation"]
    );
  }

  await client.query(
    "UPDATE public.users SET last_seen_at = NOW() WHERE id = $1",
    [userId]
  );

  return { userId, sessionId };
}

async function saveProfileUpdates(
  client,
  userId,
  updates,
  currentProfile
) {
  for (const key of PROFILE_KEYS) {
    const category = PROFILE_CATEGORY[key];

    for (const subject of updates[key]) {
      const alreadyKnown = currentProfile[key].some(
        (item) => item.toLocaleLowerCase() === subject.toLocaleLowerCase()
      );

      if (alreadyKnown) continue;

      await client.query(
        `INSERT INTO public.film_memories
           (user_id, category, subject, details, confidence)
         SELECT $1, $2, $3, $4, 0.80
         WHERE NOT EXISTS (
           SELECT 1
           FROM public.film_memories
           WHERE user_id = $1
             AND category = $2
             AND LOWER(subject) = LOWER($3)
             AND details = $4
         )`,
        [userId, category, subject, `profileKey:${key}`]
      );
    }
  }
}

export default async function handler(req) {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed." });
  }

  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not configured.");

    return json(500, {
      error: "Netty's AI service is not configured. Please try again later."
    });
  }

  try {
    cookieSecret();
    getPool();
  } catch (error) {
    console.error("Netty configuration error:", error.message);

    return json(500, {
      error: "Netty's database or identity configuration is incomplete."
    });
  }

  let body;

  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON request." });
  }

  if (body.action !== "chat") {
    return json(400, {
      error: "Unsupported action. Please refresh and try again."
    });
  }

  const incomingMessages = cleanMessages(body.messages);
  const latestMessage = incomingMessages[incomingMessages.length - 1];

  if (!latestMessage || latestMessage.role !== "user") {
    return json(400, {
      error: "Please send a message to start the conversation."
    });
  }

  const database = getPool();
  const client = await database.connect();

  let userId;
  let sessionId;
  let cookie;
  let tasteProfile;
  let conversation;

  try {
    await client.query("BEGIN");

    ({ userId, sessionId } = await getUserAndSession(
      client,
      req,
      latestMessage.text
    ));

    cookie = makeIdentityCookie(userId, sessionId);

    const memoryResult = await client.query(
      `SELECT category, subject, details
       FROM public.film_memories
       WHERE user_id = $1
       ORDER BY updated_at DESC
       LIMIT 100`,
      [userId]
    );

    tasteProfile = profileFromMemories(memoryResult.rows);

    const historyResult = await client.query(
      `SELECT role, content
       FROM public.chat_messages
       WHERE session_id = $1
       ORDER BY created_at DESC, id DESC
       LIMIT 23`,
      [sessionId]
    );

    const previousMessages = historyResult.rows
      .reverse()
      .map((row) => ({ role: row.role, text: row.content }));

    conversation = cleanMessages([
      ...previousMessages,
      latestMessage
    ]);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Could not load Netty memory:", error.message);

    return json(500, {
      error: "Netty couldn't load your conversation. Please try again."
    });
  } finally {
    client.release();
  }

  try {
    const baseUrl = (
      process.env.GOOGLE_GEMINI_BASE_URL ||
      "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");

    const aiResponse = await fetch(
      `${baseUrl}/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: buildPrompt(conversation, tasteProfile) }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const result = await aiResponse.json().catch(() => ({}));

    if (!aiResponse.ok) {
      console.error(
        "Gemini API error:",
        aiResponse.status,
        result.error?.message || "Unknown provider error"
      );

      return json(502, {
        error: "Netty couldn't get an AI response. Please try again."
      }, cookie);
    }

    const generatedText = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!generatedText) {
      console.error("Gemini returned no text.");

      return json(502, {
        error: "Netty received an empty response. Please try again."
      }, cookie);
    }

    const generated = parseGeneratedJSON(generatedText);
    const updatedProfile = mergeProfiles(
      tasteProfile,
      generated.profileUpdates
    );

    const saveClient = await database.connect();

    try {
      await saveClient.query("BEGIN");

      await saveClient.query(
        `INSERT INTO public.chat_messages (session_id, role, content)
         VALUES ($1, 'user', $2), ($1, 'assistant', $3)`,
        [sessionId, latestMessage.text, generated.reply]
      );

      await saveProfileUpdates(
        saveClient,
        userId,
        generated.profileUpdates,
        tasteProfile
      );

      await saveClient.query(
        `UPDATE public.chat_sessions
         SET updated_at = NOW(),
             title = COALESCE(title, $2)
         WHERE id = $1 AND user_id = $3`,
        [sessionId, latestMessage.text.slice(0, 80), userId]
      );

      await saveClient.query(
        "UPDATE public.users SET last_seen_at = NOW() WHERE id = $1",
        [userId]
      );

      await saveClient.query("COMMIT");
    } catch (error) {
      await saveClient.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      saveClient.release();
    }

    return json(200, {
      reply: generated.reply,
      profileUpdates: generated.profileUpdates,
      tasteProfile: updatedProfile
    }, cookie);
  } catch (error) {
    console.error("Netty backend error:", error.message);

    return json(500, {
      error: "Something went wrong while processing your message."
    }, cookie);
  }
}
