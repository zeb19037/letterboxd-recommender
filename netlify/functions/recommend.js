import { saveRecommendation } from "../../db/save-recommendation.ts";


const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const json = (status, data, extraHeaders = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });

export default async (req) => {
  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed." }, { Allow: "POST" });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("GEMINI_API_KEY is missing from Netlify environment variables.");

    return json(500, {
      error: "The recommendation service is not configured. Please try again later."
    });
  }

  try {
    const rawBody = await req.text();
    const body = rawBody ? JSON.parse(rawBody) : {};
    let prompt;

    if (body.action === "historyQuestion") {
      prompt = buildHistoryQuestionPrompt(body);
    } else if (body.action === "recommend") {
      prompt = buildRecommendationPrompt(body);
    } else {
      return json(400, { error: "Unknown action." });
    }

    const baseUrl = (
      process.env.GOOGLE_GEMINI_BASE_URL ||
      "https://generativelanguage.googleapis.com"
    ).replace(/\/$/, "");

    const result = await fetch(
      `${baseUrl}/v1beta/models/${MODEL}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
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

    const responseData = await result.json().catch(() => ({}));

    if (!result.ok) {
      const apiMessage =
        responseData.error?.message ||
        `Gemini request failed with status ${result.status}.`;

      console.error("Gemini API error:", result.status, apiMessage);

      return json(502, {
        error: `The recommendation service returned an error: ${apiMessage}`
      });
    }

    const generatedText = responseData.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!generatedText) {
      console.error("Gemini returned no text:", JSON.stringify(responseData));

      return json(502, {
        error: "Gemini returned an empty response. Please try again."
      });
    }

    const data = parseGeneratedJSON(generatedText);

    if (body.action === "recommend") {
      try {
        await saveRecommendation({
          sessionId: body.sessionId,
          usedViewingHistory: Boolean(body.historySummary),
          answers: sanitizeAnswers(body.answers),
          feedback: cleanText(body.feedback, 1000),
          result: data
        });
      } catch (error) {
        console.error("Failed to save recommendation:", error);
      }
    }

    return json(200, data);
  } catch (error) {
    console.error("Recommendation endpoint error:", error);

    if (error instanceof SyntaxError) {
      return json(400, {
        error: "Invalid JSON request body or invalid JSON returned by Gemini."
      });
    }

    return json(500, {
      error: "An unexpected server error occurred. Please try again."
    });
  }
};

function buildHistoryQuestionPrompt(body) {
  const history = sanitizeHistory(body.historySummary);
  const answers = sanitizeAnswers(body.answers);

  const questionNumber = Math.min(
    3,
    Math.max(1, Number(body.questionNumber) || answers.length + 1)
  );

  return `
You are Netty, a friendly, bubbly AI-powered Netflix recommendation assistant.

The user has chosen to share a Netflix viewing-history summary.
Ask personalized questions to improve recommendations.

IMPORTANT ETHICAL RULES:
- You are an AI, not a human. Never imply otherwise.
- Be friendly but do not pretend to know the user personally.
- Watching a title does not prove the user liked it.
- Do not ask for passwords, Netflix login details, payment information,
  real names, addresses, or other unnecessary personal information.
- Do not pressure the user to share more data.
- Be honest that recommendations can be inaccurate.
- Do not claim access to Netflix's complete or live catalog.

VIEWING HISTORY SUMMARY:
${JSON.stringify(history, null, 2)}

ANSWERS ALREADY PROVIDED:
${JSON.stringify(answers, null, 2)}

Generate personalized question ${questionNumber} of 3.

Requirements:
- Ask exactly ONE clear, useful question.
- Use the history as a clue, not as proof of the user's tastes.
- Avoid repeating information already established by previous answers.
- Explore preferences that will help distinguish between possible recommendations.
- Provide 4 to 6 concise, meaningfully different answer options.
- Include "No preference" or "Something else" when appropriate.
- Do not recommend titles yet.
- Do not ask for sensitive personal information.

Return only valid JSON:
{
  "question": "One personalized question",
  "options": ["Option 1", "Option 2", "Option 3", "Option 4"]
}
`;
}

function buildRecommendationPrompt(body) {
  const history = body.historySummary
    ? sanitizeHistory(body.historySummary)
    : null;

  const answers = sanitizeAnswers(body.answers);
  const feedback = cleanText(body.feedback, 1000);

  const rejectedTitles = Array.isArray(body.rejectedTitles)
    ? body.rejectedTitles
        .slice(0, 60)
        .map((title) => cleanText(title, 150))
        .filter(Boolean)
    : [];

  return `
You are Netty, a friendly, bubbly AI-powered Netflix recommendation assistant.

Your purpose is to suggest movies and series based on the user's answers
and, only when provided, their optional Netflix viewing-history summary.

USER PREFERENCES:
${JSON.stringify(answers, null, 2)}

OPTIONAL VIEWING HISTORY SUMMARY:
${JSON.stringify(history, null, 2)}

USER FEEDBACK:
${JSON.stringify(feedback)}

TITLES ALREADY RECOMMENDED — DO NOT RECOMMEND THESE AGAIN:
${JSON.stringify(rejectedTitles)}

ETHICAL AND PRIVACY REQUIREMENTS:
- Be transparent that you are an AI assistant, not a human.
- Recommendations are suggestions, not guarantees that the user will enjoy
  a title or that it is currently available in their Netflix catalog.
- Do not claim access to a complete, live, or up-to-date Netflix catalog.
- Do not claim certainty about the user's preferences.
- Treat viewing history as an imperfect clue. A watched title is not
  necessarily a liked title.
- Do not request or infer unnecessary personal information.
- Never request passwords, account credentials, payment information,
  real names, addresses, or other unrelated sensitive details.
- Do not pressure the user to upload viewing history.
- Respect user feedback and correct course when a recommendation misses.
- Never claim that you have permanently learned or saved the user's tastes.

RECOMMENDATION REQUIREMENTS:
1. Suggest 6 distinct movies or series that fit the user's stated preferences.
2. If history is null, use the answers alone. Do not complain about missing data.
3. Give a diverse but focused selection, not six nearly identical titles.
4. Prefer known titles plausibly associated with Netflix, but do not invent
   titles or claim their availability has been verified.
5. State that the user should check Netflix for current regional availability
   when availability is uncertain.
6. If the user gives feedback, incorporate it into the next set.
7. Do not include any title from the rejected list.
8. Explain specifically why each suggestion may fit the user's answers.
9. Keep the tone warm and conversational, without excessive flattery.
10. Do not include external links.

Return only valid JSON in this shape:
{
  "intro": "A brief, personalized introduction with appropriate uncertainty.",
  "recommendations": [
    {
      "title": "Title",
      "type": "Movie or Series",
      "genres": "Two or three genres",
      "why": "A specific explanation based on the user's answers.",
      "match": "A short label describing the appeal",
      "availabilityNote": "A concise availability caveat or an empty string"
    }
  ]
}
`;
}

function sanitizeHistory(history) {
  if (!history || typeof history !== "object") return null;

  const topTitles = Array.isArray(history.topTitles)
    ? history.topTitles.slice(0, 80).map((item) => ({
        title: cleanText(item?.title, 150),
        count: Math.max(1, Number(item?.count) || 1),
        lastSeen: cleanText(item?.lastSeen, 60)
      }))
    : [];

  return {
    totalEntries: Math.max(0, Number(history.totalEntries) || 0),
    uniqueTitles: Math.max(0, Number(history.uniqueTitles) || 0),
    topTitles
  };
}

function sanitizeAnswers(answers) {
  if (!Array.isArray(answers)) return [];

  return answers.slice(0, 8).map((item) => ({
    question: cleanText(item?.question, 500),
    answer: cleanText(item?.answer, 1000)
  }));
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function parseGeneratedJSON(text) {
  let candidate = text.trim();

  candidate = candidate
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(candidate);
  } catch {
    const firstBrace = candidate.indexOf("{");
    const lastBrace = candidate.lastIndexOf("}");

    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
    }

    throw new Error("Gemini returned invalid JSON. Please try again.");
  }
}
