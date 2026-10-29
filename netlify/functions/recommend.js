
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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

function json(status, data) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
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

function cleanProfile(value) {
  const profile =
    value && typeof value === "object" && !Array.isArray(value)
      ? value
      : {};

  return Object.fromEntries(
    PROFILE_KEYS.map((key) => [key, cleanList(profile[key])])
  );
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

      return {
        role: message.role,
        text
      };
    })
    .filter(Boolean);
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

PRIVACY
- Respect the user's stated content boundaries.
- Do not ask for passwords, payment details, or unnecessary personal data.
- Treat the taste profile as helpful context, not a complete description
  of the person.
- Only add profile information that the user clearly states.
- Do not infer a strong preference from a casual mention.

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

profileUpdates should include only new, meaningful information from
the latest user message. Use empty arrays when there is nothing new.
Do not repeat items already in the profile. The reply should sound
natural and should answer the user's actual message.
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

    const messages = cleanMessages(body.messages);

    if (!messages.length) {
      return json(400, {
        error: "Please send a message to start the conversation."
      });
    }

    if (messages[messages.length - 1].role !== "user") {
      return json(400, {
        error: "The latest message must be from the user."
      });
    }

    const tasteProfile = cleanProfile(body.tasteProfile);
    const prompt = buildPrompt(messages, tasteProfile);

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
              parts: [{ text: prompt }]
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
      });
    }

    const generatedText = result.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!generatedText) {
      console.error("Gemini returned no text.", result);

      return json(502, {
        error: "Netty received an empty response. Please try again."
      });
    }

    return json(200, parseGeneratedJSON(generatedText));
  } catch (error) {
    console.error("Netty backend error:", error);

    return json(500, {
      error: "Something went wrong while processing your message."
    });
  }
}
