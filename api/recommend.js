
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

function send(res, status, data) {
  return res.status(status).json(data);
}

function str(value, max = 1000) {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function parseJSON(text) {
  const clean = (text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  try {
    return JSON.parse(clean);
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(clean.slice(start, end + 1));
    }

    throw new Error("Gemini returned invalid JSON. Please retry.");
  }
}

async function gemini(prompt) {
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    const error = new Error(
      "GEMINI_API_KEY is missing from your Vercel environment variables."
    );
    error.status = 500;
    throw error;
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(MODEL) +
    ":generateContent?key=" + encodeURIComponent(key);

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: "application/json"
      }
    })
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data?.error?.message || "Gemini request failed."
    );

    error.status =
      response.status === 429 || response.status === 503
        ? 503
        : 502;

    throw error;
  }

  const text = data?.candidates?.[0]?.content?.parts
    ?.map(part => part.text || "")
    .join("\n");

  return parseJSON(text);
}

function questionPrompt(history, answers, number) {
  const previous = answers.map((a, i) =>
    (i + 1) + ". Question: " + str(a.question, 300) +
    "\nAnswer: " + str(a.answer, 300)
  ).join("\n");

  return [
    "You are a thoughtful TV and movie recommendation interviewer.",
    'Return JSON with keys "text" and "options".',
    '"text" must be one concise question.',
    '"options" must contain exactly four short answer strings.',
    "",
    "VIEWING HISTORY SUMMARY:",
    history,
    "",
    "PREVIOUS QUESTIONS AND ANSWERS:",
    previous || "(none yet)",
    "",
    "This is question " + (number + 1) + " of exactly three.",
    "The history shows what was watched, not what was liked.",
    "Never assume frequent watching proves enjoyment.",
    "Question 1: learn their current mood or what they want to watch.",
    "Question 2: build directly on question 1 and the history.",
    "Question 3: use both previous answers to resolve a useful tradeoff.",
    "Ask a new question each time. Do not repeat earlier questions.",
    "Use four distinct, relevant options. Do not recommend titles yet.",
    'Return JSON only: {"text":"...","options":["...","...","...","..."]}'
  ].join("\n");
}

function recommendationPrompt(history, answers, feedback, oldFeedback, rejected) {
  const answerText = answers.map((a, i) =>
    (i + 1) + ". " + str(a.question, 300) +
    "\nAnswer: " + str(a.answer, 300)
  ).join("\n");

  return [
    "You are a careful TV and movie recommendation assistant.",
    'Return JSON containing a "recommendations" array of six items.',
    'Each item must have "title", "year", "type", "genres", "why", and "match".',
    '"type" should be "Series" or "Movie".',
    '"why" should contain two concise, spoiler-free sentences.',
    '"match" should briefly name the preference that makes it relevant.',
    "",
    "VIEWING HISTORY SUMMARY (not ratings):",
    history,
    "",
    "THE USER'S THREE ANSWERS:",
    answerText,
    "",
    "LATEST FEEDBACK:",
    str(feedback, 800) || "(first recommendation round)",
    "",
    "EARLIER FEEDBACK:",
    JSON.stringify(oldFeedback || []),
    "",
    "DO NOT RECOMMEND THESE TITLES AGAIN:",
    JSON.stringify(rejected || []),
    "",
    "RULES:",
    "- Recommend real, released titles. Do not invent titles.",
    "- Prefer well-known titles if uncertain.",
    "- Prioritize the user's answers and current mood over viewing frequency.",
    "- Do not assume they liked something just because they watched it.",
    "- Follow the feedback and avoid the previously shown titles.",
    "- Avoid near-duplicate recommendations.",
    "- Do not claim Netflix availability is verified.",
    "- Do not include spoilers or markdown.",
    'Return JSON only: {"recommendations":[{"title":"...","year":"2020","type":"Series","genres":"Mystery","why":"...","match":"..."}]}'
  ].join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return send(res, 405, { error: "Use a POST request." });
  }

  try {
    let body = req.body;

    if (typeof body === "string") {
      if (body.length > 30000) {
        return send(res, 413, { error: "Request is too large." });
      }

      try {
        body = JSON.parse(body);
      } catch {
        return send(res, 400, { error: "Invalid JSON request." });
      }
    }

    if (!body || typeof body !== "object") {
      return send(res, 400, { error: "Invalid request." });
    }

    const history = str(body.historySummary, 11000);

    if (!history.trim()) {
      return send(res, 400, { error: "Upload a valid Netflix history CSV first." });
    }

    const answers = Array.isArray(body.answers)
      ? body.answers.slice(0, 3)
      : [];

    if (body.mode === "question") {
      const number = Number(body.questionNumber);

      if (![0, 1, 2].includes(number) || answers.length !== number) {
        return send(res, 400, {
          error: "The question sequence is invalid. Please start over."
        });
      }

      const result = await gemini(
        questionPrompt(history, answers, number)
      );

      if (
        typeof result.text !== "string" ||
        !Array.isArray(result.options) ||
        result.options.length < 2
      ) {
        return send(res, 502, {
          error: "Gemini returned an incomplete question. Please retry."
        });
      }

      return send(res, 200, {
        question: {
          text: str(result.text, 500),
          options: result.options.slice(0, 4).map(option =>
            str(option, 160)
          )
        }
      });
    }

    if (body.mode === "recommend") {
      if (answers.length !== 3) {
        return send(res, 400, {
          error: "Please answer all three questions first."
        });
      }

      const result = await gemini(
        recommendationPrompt(
          history,
          answers,
          str(body.feedback, 800),
          Array.isArray(body.feedbackHistory)
            ? body.feedbackHistory.slice(-4)
            : [],
          Array.isArray(body.rejectedTitles)
            ? body.rejectedTitles.slice(-30).map(t => str(t, 150))
            : []
        )
      );

      const recommendations = Array.isArray(result.recommendations)
        ? result.recommendations.slice(0, 6).map(item => ({
            title: str(item.title, 180),
            year: str(String(item.year || ""), 12),
            type: str(item.type, 30),
            genres: str(item.genres, 100),
            why: str(item.why, 500),
            match: str(item.match, 180)
          })).filter(item => item.title)
        : [];

      return send(res, 200, { recommendations });
    }

    return send(res, 400, { error: "Unknown request mode." });
  } catch (error) {
    console.error("Recommendation API error:", error.message);

    const status = Number(error.status) || 500;

    return send(res, status, {
      error: status === 503
        ? "Gemini is busy or rate-limiting requests. Wait a moment and retry."
        : str(error.message, 500) || "Something went wrong."
    });
  }
}
