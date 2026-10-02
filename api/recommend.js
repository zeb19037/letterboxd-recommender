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
      return res.status(400).json({
        error: "Invalid recommendation profile."
      });
    }

    const payload = JSON.stringify(profile);

    // Basic abuse/cost protection.
    if (payload.length > 50000) {
      return res.status(413).json({
        error: "Recommendation profile is too large."
      });
    }

    /*
     * Primary model:
     * Use a lighter model than Gemini 3.8 Flash to reduce the chance
     * of capacity-related 503 errors.
     *
     * Fallback:
     * If the primary model remains unavailable after retries,
     * try an even lighter model.
     */
    const primaryModel = "gemini-3.6-flash";
    const fallbackModel = "gemini-3.5-flash-lite";

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
**Why it fits:** ...
**What to expect:** ...

## 3. Title (Year)
**Why it fits:** ...
**What to expect:** ...

## 4. Title (Year)
**Why it fits:** ...
**What to expect:** ...

## 5. Title (Year)
**Why it fits:** ...
**What to expect:** ...

Finish with:

## Why these five
A short paragraph describing the overall pattern you used.
`;

    const userPrompt = `
Here is the user's structured Letterboxd profile:

${payload}

Generate the personalized recommendations now.
`;

    /*
     * Gemini can temporarily return 503/429/5xx when capacity is limited.
     * Retry those errors using exponential backoff before giving up.
     */
    async function callGemini(model, maxRetries = 3) {
      let lastResult = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(
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

          const result = await response.json();
          lastResult = { response, result };

          // Successful request.
          if (response.ok) {
            return lastResult;
          }

          /*
           * Only retry temporary/transient errors.
           * Do NOT retry authentication, invalid-request, or other
           * permanent client errors.
           */
          const retryable =
            response.status === 408 ||
            response.status === 429 ||
            response.status === 500 ||
            response.status === 502 ||
            response.status === 503 ||
            response.status === 504;

          if (!retryable || attempt === maxRetries) {
            return lastResult;
          }

          // Exponential backoff: 2s, 4s, 8s.
          const delay = 2000 * Math.pow(2, attempt);

          console.log(
            `Gemini ${model} returned ${response.status}. ` +
            `Retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries}).`
          );

          await new Promise(resolve => setTimeout(resolve, delay));
        } catch (error) {
          /*
           * Network failures are also temporary in many cases,
           * so retry them using the same backoff strategy.
           */
          if (attempt === maxRetries) {
            throw error;
          }

          const delay = 2000 * Math.pow(2, attempt);

          console.log(
            `Gemini network error. Retrying in ${delay}ms ` +
            `(attempt ${attempt + 1}/${maxRetries}).`
          );

          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      return lastResult;
    }

    /*
     * First try the lighter primary model.
     */
    let geminiResult = await callGemini(primaryModel);

    /*
     * If the primary model is unavailable after retries, switch
     * automatically to the even lighter fallback model.
     */
    if (!geminiResult?.response?.ok) {
      const status = geminiResult?.response?.status;

      const shouldFallback =
        status === 408 ||
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504;

      if (shouldFallback) {
        console.log(
          `${primaryModel} remained unavailable. ` +
          `Trying fallback model ${fallbackModel}.`
        );

        geminiResult = await callGemini(fallbackModel, 2);
      }
    }

    if (!geminiResult?.response?.ok) {
      console.error(
        "Gemini API error:",
        geminiResult?.result || "Unknown Gemini error"
      );

      const status = geminiResult?.response?.status;

      if (status === 503) {
        return res.status(503).json({
          error:
            "Gemini is temporarily experiencing high demand. " +
            "Please try again in a moment."
        });
      }

      if (status === 429) {
        return res.status(429).json({
          error:
            "The AI service is temporarily rate-limited. " +
            "Please try again in a moment."
        });
      }

      return res.status(502).json({
        error:
          "The AI provider returned an error. " +
          "Please try again."
      });
    }

    const result = geminiResult.result;

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
