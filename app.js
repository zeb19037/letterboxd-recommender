
const $ = id => document.getElementById(id);

const state = {
  history: "",
  stats: null,
  answers: [],
  question: null,
  recommendations: [],
  rejected: [],
  feedbackHistory: [],
  busy: false
};

function parseCSV(text) {
  const rows = [];
  let row = [], field = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"' && !field) {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  return rows.filter(r => r.some(v => v.trim()));
}

function inferSeries(title) {
  const match = title.match(
    /^(.+?):\s*(?:Season\s+\d+|Series\s+\d+|Part\s+\d+|Volume\s+\d+)(?:\s*:|$)/i
  );

  if (match) return match[1].trim();

  // Some Netflix entries don't contain an explicit season label.
  return title;
}

function buildSummary(csvText) {
  const rows = parseCSV(csvText);

  if (rows.length < 2) {
    throw new Error("The CSV appears to be empty.");
  }

  const headers = rows[0].map(h =>
    h.trim().toLowerCase().replace(/^\uFEFF/, "")
  );

  const titleCol = headers.findIndex(h => h === "title");
  const dateCol = headers.findIndex(h => h === "date");

  if (titleCol < 0) {
    throw new Error(
      'Could not find the "Title" column. Upload your Netflix Viewing activity CSV.'
    );
  }

  const entries = rows.slice(1)
    .map(r => ({
      title: String(r[titleCol] || "").trim(),
      date: dateCol >= 0 ? String(r[dateCol] || "").trim() : ""
    }))
    .filter(e => e.title);

  if (!entries.length) {
    throw new Error("No viewing entries were found.");
  }

  const counts = new Map();
  const exactCounts = new Map();

  for (const entry of entries) {
    const series = inferSeries(entry.title);
    counts.set(series, (counts.get(series) || 0) + 1);
    exactCounts.set(
      entry.title,
      (exactCounts.get(entry.title) || 0) + 1
    );
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1]);

  const recent = entries
    .filter(e => e.date)
    .slice()
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, 15);

  const summary = [
    "Netflix viewing-history summary.",
    "This represents watched content, not ratings or confirmed favorites.",
    "Total viewing entries: " + entries.length,
    "Distinct exact titles: " + exactCounts.size,
    "Inferred series/title groups: " + counts.size,
    "Most frequent groups:",
    ...ranked.slice(0, 30).map(
      ([title, count]) => "- " + title.slice(0, 100) + ": " + count + " entries"
    ),
    "Recent viewing entries:",
    ...recent.map(e => "- " + e.date + ": " + e.title.slice(0, 120)),
    "Do not assume frequent viewing means the user enjoyed the title."
  ].join("\n");

  return {
    summary: summary.slice(0, 10000),
    stats: {
      entries: entries.length,
      groups: counts.size
    }
  };
}

function message(text, who = "assistant") {
  const el = document.createElement("div");
  el.className = "message " + who;
  el.textContent = text;
  $("chatMessages").appendChild(el);
}

function busy(value, text = "Thinking...") {
  state.busy = value;
  $("loadingArea").classList.toggle("hidden", !value);
  $("loadingText").textContent = text;
  $("startButton").disabled = value || !$("historyFile").files[0];
  $("retryButton").disabled = value;

  document.querySelectorAll(".option-button, #answerForm button")
    .forEach(button => button.disabled = value);
}

async function api(payload) {
  const response = await fetch("/api/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "The request failed.");
  }

  return data;
}

function progress() {
  const count = state.answers.length;
  const percent = count >= 3 ? 100 : Math.round((count + 1) / 3 * 100);

  $("progressText").textContent =
    count >= 3 ? "PREFERENCES COMPLETE" : `QUESTION ${count + 1} OF 3`;

  $("progressPercent").textContent = percent + "%";
  $("progressBar").style.width = percent + "%";
}

function showQuestion(question) {
  state.question = question;
  $("questionPrompt").textContent = question.text;
  $("optionList").replaceChildren();

  question.options.slice(0, 4).forEach(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option-button";
    button.textContent = option;
    button.addEventListener("click", () => answer(option));
    $("optionList").appendChild(button);
  });

  $("questionArea").classList.remove("hidden");
  $("recommendationArea").classList.add("hidden");
  progress();
}

async function start() {
  if (state.busy) return;

  const file = $("historyFile").files[0];
  if (!file) return;

  $("uploadStatus").textContent = "";
  busy(true, "Reading your CSV locally...");

  try {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      throw new Error("Please choose a CSV file.");
    }

    if (file.size > 15 * 1024 * 1024) {
      throw new Error("The file is too large. Please use a CSV under 15 MB.");
    }

    const result = buildSummary(await file.text());

    state.history = result.summary;
    state.stats = result.stats;
    state.answers = [];
    state.recommendations = [];
    state.rejected = [];
    state.feedbackHistory = [];

    $("chatMessages").replaceChildren();
    $("recommendationArea").classList.add("hidden");
    $("uploadPanel").classList.add("hidden");
    $("chatPanel").classList.remove("hidden");
    $("profileSummary").textContent =
      result.stats.entries.toLocaleString() + " viewing entries · " +
      result.stats.groups.toLocaleString() + " inferred groups";

    message(
      "I've analyzed your viewing history. It shows what you watched, not necessarily what you liked. Let's narrow down what you want to watch now."
    );

    busy(true, "Personalizing your first question...");

    const resultQuestion = await api({
      mode: "question",
      historySummary: state.history,
      answers: [],
      questionNumber: 0
    });

    showQuestion(resultQuestion.question);
  } catch (error) {
    $("uploadStatus").textContent = error.message;
    $("chatPanel").classList.add("hidden");
    $("uploadPanel").classList.remove("hidden");
  } finally {
    busy(false);
  }
}

async function answer(value) {
  const text = String(value || "").trim();

  if (!text || state.busy || state.answers.length >= 3) return;

  state.answers.push({
    question: state.question.text,
    answer: text
  });

  message(text, "user");
  $("customAnswer").value = "";
  $("questionArea").classList.add("hidden");

  busy(true, state.answers.length < 3
    ? "Using that answer to shape your next question..."
    : "Finding recommendations for you...");

  try {
    if (state.answers.length < 3) {
      const result = await api({
        mode: "question",
        historySummary: state.history,
        answers: state.answers,
        questionNumber: state.answers.length
      });

      message("Thanks—that helps me narrow it down.");
      showQuestion(result.question);
    } else {
      await recommend("");
    }
  } catch (error) {
    state.answers.pop();
    $("questionArea").classList.remove("hidden");
    message("I couldn't complete that step: " + error.message);
  } finally {
    busy(false);
  }
}

async function recommend(feedback) {
  const result = await api({
    mode: "recommend",
    historySummary: state.history,
    answers: state.answers,
    feedback: feedback || "",
    feedbackHistory: state.feedbackHistory.slice(-4),
    rejectedTitles: state.rejected.slice(-30)
  });

  const items = Array.isArray(result.recommendations)
    ? result.recommendations
    : [];

  render(items);
}

function render(items) {
  const list = $("recommendationList");
  list.replaceChildren();

  // Exclude results already shown in subsequent rounds.
  state.recommendations.forEach(item => {
    if (item.title && !state.rejected.includes(item.title)) {
      state.rejected.push(item.title);
    }
  });

  state.recommendations = items;

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No recommendations were returned. Add feedback and retry.";
    list.appendChild(empty);
  }

  items.forEach((item, index) => {
    const card = document.createElement("article");
    card.className = "rec-card";

    const number = document.createElement("div");
    number.className = "rec-number";
    number.textContent = String(index + 1).padStart(2, "0");

    const content = document.createElement("div");
    content.className = "rec-content";

    const title = document.createElement("h3");
    title.className = "rec-title";
    title.textContent = item.title || "Untitled";

    const meta = document.createElement("div");
    meta.className = "rec-meta";
    meta.textContent = [item.year, item.type, item.genres]
      .filter(Boolean).join(" · ");

    const why = document.createElement("p");
    why.className = "rec-why";
    why.textContent = item.why || "Suggested based on your preferences.";

    const match = document.createElement("p");
    match.className = "match-label";
    match.textContent = item.match || "Why it may fit";

    const link = document.createElement("a");
    link.className = "rec-link";
    link.href = "https://www.netflix.com/search?q=" +
      encodeURIComponent(item.title || "");
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Search Netflix ↗";

    content.append(title, meta, why, match, link);
    card.append(number, content);
    list.appendChild(card);
  });

  $("recommendationArea").classList.remove("hidden");
  $("questionArea").classList.add("hidden");
  $("recommendationArea").scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

$("historyFile").addEventListener("change", () => {
  const file = $("historyFile").files[0];
  $("filePrompt").textContent = file
    ? file.name
    : "Choose your Netflix history CSV";

  $("startButton").disabled = !file || state.busy;
  $("uploadStatus").textContent = "";
});

$("startButton").addEventListener("click", start);

$("answerForm").addEventListener("submit", event => {
  event.preventDefault();
  answer($("customAnswer").value);
});

$("changeFileButton").addEventListener("click", () => {
  $("chatPanel").classList.add("hidden");
  $("uploadPanel").classList.remove("hidden");
  $("historyFile").value = "";
  $("filePrompt").textContent = "Choose your Netflix history CSV";
  $("startButton").disabled = true;
});

$("feedbackForm").addEventListener("submit", async event => {
  event.preventDefault();

  if (state.busy) return;

  const feedback = $("feedbackInput").value.trim();

  if (!feedback) {
    $("feedbackStatus").textContent =
      "Tell me what you want changed before retrying.";
    return;
  }

  state.feedbackHistory.push({
    feedback,
    titles: state.recommendations.map(r => r.title)
  });

  $("feedbackStatus").textContent = "";
  busy(true, "Refining your recommendations...");

  try {
    await recommend(feedback);
    $("feedbackInput").value = "";
    $("feedbackStatus").textContent =
      "Updated shortlist ready. Your three answers are still included.";
  } catch (error) {
    $("feedbackStatus").textContent = error.message;
  } finally {
    busy(false);
  }
});

$("startOverButton").addEventListener("click", () => {
  Object.assign(state, {
    history: "",
    stats: null,
    answers: [],
    question: null,
    recommendations: [],
    rejected: [],
    feedbackHistory: [],
    busy: false
  });

  $("chatMessages").replaceChildren();
  $("recommendationList").replaceChildren();
  $("feedbackInput").value = "";
  $("feedbackStatus").textContent = "";
  $("chatPanel").classList.add("hidden");
  $("uploadPanel").classList.remove("hidden");
  $("historyFile").value = "";
  $("filePrompt").textContent = "Choose your Netflix history CSV";
  $("startButton").disabled = true;
});
