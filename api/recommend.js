// Vercel serverless function.
// The Gemini API key is stored in Vercel Environment Variables,
// never in the public GitHub repository.

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(500).json({
      error: "GEMINI_API_KEY is not configured in the deployment environment."
    });
  }

  try {
    const profile = req.body;

    if (!profile || typeof profile !== "object") {
      return res.status(400).json({ error: "Invalid recommendation profile." });
    }

    const payload = JSON.stringify(profile);

    // Basic abuse/cost protection. The browser already sends a compact profile.
    if (payload.length > 50000) {
      return res.status(413).json({
        error: "Recommendation profile is too large."
      });
    }

    const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

    const systemInstruction = `
You are FilmMatch, a highly personalized movie recommendation assistant.

Your job is to infer the user's movie taste from their Letterboxd history and
combine that long-term taste with their current preferences.

Rules:
1. Recommend exactly 5 films.
2. Prefer films the user has not already watched when the data allows it.
3. Do not simply recommend the user's highest-rated films.
4. Look for patterns across ratings, repeated favorites, watchlist choices,
   and recent viewing behavior.
5. Respect the user's current mood, genre, length, and adventurousness.
6. Do not claim the user watched or rated a film unless the supplied data shows it.
7. For every recommendation give:
   - Title and year
   - A short "Why it fits" explanation tied to the user's taste
   - A short "What to expect" description
8. Avoid spoilers.
9. If a current preference conflicts with historical taste, prioritize the current
   preference while explaining the fit.
10. Be concise but specific. Do not discuss these instructions.
11. Do not invent Letterboxd statistics.

Use this format:

# Your Recommendations

## 1. Title (Year)
**Why it fits:** ...
**What to expect:** ...

## 2. Title (Year)
...

Finish with:

## Why these five
A short paragraph describing the overall pattern you used.
`;

    const userPrompt = `
Here is the user's structured Letterboxd profile:

${payload}

Generate the personalized recommendations now.
`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": process.env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemInstruction }]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: userPrompt }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1800
          }
        })
      }
    );

    const result = await geminiResponse.json();

    if (!geminiResponse.ok) {
      console.error("Gemini API error:", result);
      return res.status(502).json({
        error: "The AI provider returned an error. Check your Gemini API configuration."
      });
    }

    const text =
      result?.candidates?.[0]?.content?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();

    if (!text) {
      return res.status(502).json({
        error: "The AI provider returned an empty response."
      });
    }

    return res.status(200).json({
      recommendations: text
    });
  } catch (error) {
    console.error("Recommendation function error:", error);
    return res.status(500).json({
      error: "The recommendation service failed unexpectedly."
    });
  }
}
