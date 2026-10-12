
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is missing from your Vercel environment variables."
    });
  }

  try {
    const body = req.body || {};
    let prompt;

    if (body.action === "historyQuestion") {
      prompt = buildHistoryQuestionPrompt(body);
    } else if (body.action === "recommend") {
      prompt = buildRecommendationPrompt(body);
    } else {
      return res.status(400).json({ error: "Unknown action." });
    }

    const result = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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

      return res.status(502).json({
        error: `The recommendation service returned an error: ${apiMessage}`
      });
    }

    const generatedText =
      responseData.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || "")
        .join("")
        .trim();

    if (!generatedText) {
      return res.status(502).json({
        error: "Gemini returned an empty response. Please try again."
      });
    }

    const parsed = parseGeneratedJSON(generatedText);

    return res.status(200).json(parsed);
  } catch (error) {
    console.error("Recommendation endpoint error:", error);

    return res.status(500).json({
      error: error.message || "An unexpected server error occurred."
    });
  }
}

function buildHistoryQuestionPrompt(body) {
  const history = sanitizeHistory(body.historySummary);
  const answers = sanitizeAnswers(body.answers);
  const questionNumber = Math.min(
    3,
    Math.max(1, Number(body.questionNumber) || answers.length + 1)
  );

  return `
You are a thoughtful Netflix recommendation assistant.

The user opted to upload their Netflix viewing history. Use the history
to ask personalized questions that will improve your recommendations.

VIEWING HISTORY SUMMARY:
${JSON.stringify(history, null, 2)}

ANSWERS ALREADY PROVIDED:
${JSON.stringify(answers, null, 2)}

You are generating personalized question ${questionNumber} of 3.

Requirements:
- Ask exactly ONE clear, useful question.
- Use the viewing history and earlier answers to make the question relevant.
- Do not merely ask which genres the user likes if their history already
  gives useful evidence about their tastes.
- Explore something not yet established, such as desired mood, willingness
  to try a new genre, preferred pacing, format, language, or content limits.
- Do not assume that watching a title means the user liked it.
- Keep the question concise and conversational.
- Provide 4 to 6 short answer options.
- Make the options meaningfully different.
- Include "Something else" or "No preference" when appropriate.
- Do not generate recommendations yet.

Return only valid JSON in this shape:
{
  "question": "Your one question",
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
You are an expert entertainment recommender helping a user choose something
to watch on Netflix.

USER PREFERENCES:
${JSON.stringify(answers, null, 2)}

OPTIONAL NETFLIX VIEWING HISTORY SUMMARY:
${JSON.stringify(history, null, 2)}

USER FEEDBACK ON THE PREVIOUS SET:
${JSON.stringify(feedback)}

TITLES ALREADY RECOMMENDED — DO NOT RECOMMEND THESE AGAIN:
${JSON.stringify(rejectedTitles)}

Your task:
1. Recommend 6 distinct movies or TV series that fit the user's preferences.
2. Use viewing history only when provided. If it is null, base your choices
   on the five answers and do not complain about missing history.
3. Do not assume that a title was enjoyed simply because it appears in
   viewing history.
4. Give a diverse but focused selection. Avoid recommending six near-identical
   titles.
5. Prefer titles that are known to be associated with Netflix. Do not invent
   titles or claim that availability is verified in the user's country.
6. If you are uncertain whether a title is currently available on Netflix,
   say availability should be checked in Netflix.
7. If the user gives feedback, use it to improve the next set.
8. Never include any title from the rejected list.
9. Give specific, useful reasons for each recommendation. Avoid generic
   statements such as "you might like this."
10. Do not include external links.

Return only valid JSON in this shape:
{
  "intro": "A short, personalized introduction to the recommendations.",
  "recommendations": [
    {
      "title": "Title",
      "type": "Movie or Series",
      "genres": "Two or three genres",
      "why": "A specific explanation of why this matches the user's answers.",
      "match": "A short label describing the appeal",
      "availabilityNote": "A short availability caveat if needed, otherwise an empty string"
    }
  ]
}
`;
}

function sanitizeHistory(history) {
  if (!history || typeof history !== "object") return null;

  const topTitles = Array.isArray(history.topTitles)
    ? history.topTitles.slice(0, 80).map((item) => ({
        title: cleanText(item.title, 150),
        count: Math.max(1, Number(item.count) || 1),
        lastSeen: cleanText(item.lastSeen, 60)
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

  // Tolerate fenced JSON if the model returns it despite JSON mode.
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
