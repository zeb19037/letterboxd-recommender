let letterboxdData = null;
let generatedProfile = null;

const $ = (id) => document.getElementById(id);

const zipInput = $("zipInput");
const dropZone = $("dropZone");

zipInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) processZip(file);
});

["dragenter", "dragover"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
  });
});

dropZone.addEventListener("drop", (event) => {
  const file = event.dataTransfer.files?.[0];
  if (file) processZip(file);
});

$("buildPrompt").addEventListener("click", buildRecommendationProfile);
$("copyPrompt").addEventListener("click", copyPrompt);
$("downloadProfile").addEventListener("click", downloadProfile);

async function processZip(file) {
  setStatus(`Reading ${file.name}…`);

  try {
    if (!file.name.toLowerCase().endsWith(".zip")) {
      throw new Error("Please select the ZIP file downloaded from Letterboxd.");
    }

    const zip = await JSZip.loadAsync(file);
    const csvFiles = Object.values(zip.files)
      .filter((entry) => !entry.dir && entry.name.toLowerCase().endsWith(".csv"));

    if (!csvFiles.length) {
      throw new Error("No CSV files were found inside this ZIP.");
    }

    const parsed = {};

    for (const entry of csvFiles) {
      const csvText = await entry.async("text");
      parsed[entry.name] = parseCsv(csvText);
    }

    letterboxdData = normalizeLetterboxdData(parsed);

    renderProfile(letterboxdData);
    $("profileCard").classList.remove("hidden");
    $("questionsCard").classList.remove("hidden");

    setStatus(
      `Loaded ${csvFiles.length} CSV files successfully. Your Letterboxd data was processed locally in this browser.`
    );
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Something went wrong while reading the ZIP.", true);
  }
}

function parseCsv(text) {
  const result = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim()
  });

  if (result.errors?.length) {
    console.warn("CSV parsing warnings:", result.errors);
  }

  return result.data;
}

function normalizeLetterboxdData(files) {
  const rowsFor = (filename) => {
    const key = Object.keys(files).find(
      (name) => name.toLowerCase().endsWith(`/${filename}`) ||
                name.toLowerCase() === filename
    );
    return key ? files[key] : [];
  };

  const ratings = rowsFor("ratings.csv");
  const watched = rowsFor("watched.csv");
  const diary = rowsFor("diary.csv");
  const reviews = rowsFor("reviews.csv");
  const watchlist = rowsFor("watchlist.csv");
  const profile = rowsFor("profile.csv");

  const ratingsByFilm = new Map(
    ratings
      .filter(row => row.Name)
      .map(row => [filmKey(row), row])
  );

  const films = dedupeByKey([
    ...watched.map(row => enrichFilm(row, ratingsByFilm)),
    ...ratings.map(row => enrichFilm(row, ratingsByFilm)),
    ...diary.map(row => enrichFilm(row, ratingsByFilm)),
    ...reviews.map(row => enrichFilm(row, ratingsByFilm))
  ]);

  const ratedFilms = films.filter(f => Number.isFinite(f.rating));
  const highlyRated = ratedFilms
    .filter(f => f.rating >= 4)
    .sort((a, b) => b.rating - a.rating);

  return {
    profile,
    films,
    ratings,
    watched,
    diary,
    reviews,
    watchlist,
    files: Object.keys(files),
    stats: {
      rated: ratedFilms.length,
      watched: watched.length,
      diaryEntries: diary.length,
      reviews: reviews.length,
      watchlist: watchlist.length,
      fiveStar: ratedFilms.filter(f => f.rating === 5).length,
      fourPlus: highlyRated.length
    },
    examples: {
      favorites: highlyRated.slice(0, 20).map(f => ({
        title: f.title,
        year: f.year,
        rating: f.rating
      })),
      watchlist: watchlist.slice(0, 20).map(row => ({
        title: row.Name || row.Title || "",
        year: row.Year || ""
      }))
    }
  };
}

function enrichFilm(row, ratingsByFilm) {
  const ratingRow = ratingsByFilm.get(filmKey(row));
  const ratingValue = Number(row.Rating || ratingRow?.Rating);

  return {
    title: row.Name || row.Title || "",
    year: row.Year || "",
    rating: Number.isFinite(ratingValue) && ratingValue > 0 ? ratingValue : null,
    watchedDate: row.Date || row.WatchedDate || "",
    rewatch: row.Rewatch || "",
    tags: row.Tags || "",
    review: row.Review || "",
    source: row.Source || ""
  };
}

function filmKey(row) {
  const name = (row.Name || row.Title || "").trim().toLowerCase();
  const year = (row.Year || "").trim();
  return `${name}|${year}`;
}

function dedupeByKey(rows) {
  const map = new Map();

  for (const row of rows) {
    const key = filmKey(row);
    if (!key || key === "|") continue;

    const existing = map.get(key) || {};
    map.set(key, { ...existing, ...row });
  }

  return [...map.values()];
}

function renderProfile(data) {
  const stats = data.stats;

  $("profileSummary").innerHTML = `
    <div class="stat">
      <span class="stat-value">${stats.rated}</span>
      <span class="stat-label">Rated films</span>
    </div>
    <div class="stat">
      <span class="stat-value">${stats.watched}</span>
      <span class="stat-label">Watched entries</span>
    </div>
    <div class="stat">
      <span class="stat-value">${stats.fiveStar}</span>
      <span class="stat-label">5-star ratings</span>
    </div>
    <div class="stat">
      <span class="stat-value">${stats.watchlist}</span>
      <span class="stat-label">Watchlist</span>
    </div>
  `;

  $("fileSummary").textContent =
    `Detected ${data.files.length} CSV files: ${data.files.join(", ")}`;
}

function buildRecommendationProfile() {
  if (!letterboxdData) return;

  const preferences = {
    mood: $("mood").value,
    genre: $("genre").value,
    length: $("length").value,
    familiarity: $("familiarity").value,
    extra: $("extra").value.trim()
  };

  generatedProfile = {
    source: "Letterboxd export",
    generatedAt: new Date().toISOString(),
    privacy: {
      processedLocally: true,
      serverUploadByThisPrototype: false
    },
    profile: {
      stats: letterboxdData.stats,
      highlyRatedFilms: letterboxdData.examples.favorites,
      watchlistSample: letterboxdData.examples.watchlist
    },
    currentPreferences: preferences
  };

  const prompt = createAiPrompt(generatedProfile);

  $("profileOutput").textContent = prompt;
  $("resultCard").classList.remove("hidden");
  $("resultCard").scrollIntoView({ behavior: "smooth", block: "start" });
}

function createAiPrompt(profile) {
  return `You are a personalized movie recommendation assistant.

Use the user's Letterboxd history as long-term taste information and their current answers as short-term preferences.

IMPORTANT:
- Do not simply recommend the user's highest-rated movies.
- Infer patterns from the user's ratings and history.
- Prioritize movies the user has not already watched.
- Explain why each recommendation fits this specific user.
- If the available profile data is insufficient to make a strong inference, say so.
- Give 5 recommendations.
- For each recommendation include: title, year, and a concise personalized reason.

USER PROFILE
${JSON.stringify(profile, null, 2)}

Return the recommendations in a clean, readable format.`;
}

async function copyPrompt() {
  if (!generatedProfile) return;

  const prompt = createAiPrompt(generatedProfile);

  try {
    await navigator.clipboard.writeText(prompt);
    $("copyStatus").textContent = "Copied to clipboard.";
  } catch {
    $("copyStatus").textContent = "Copy failed. Select and copy the text manually.";
  }
}

function downloadProfile() {
  if (!generatedProfile) return;

  const blob = new Blob(
    [JSON.stringify(generatedProfile, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "letterboxd-recommendation-profile.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function setStatus(message, isError = false) {
  const element = $("uploadStatus");
  element.textContent = message;
  element.classList.remove("hidden", "error");
  if (isError) element.classList.add("error");
}
