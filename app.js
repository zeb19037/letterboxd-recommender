
const messagesEl = document.getElementById("messages");
const choicesEl = document.getElementById("choices");
const recommendationsEl = document.getElementById("recommendations");
const uploadStatusEl = document.getElementById("upload-status");
const answerForm = document.getElementById("answer-form");
const answerInput = document.getElementById("answer-input");
const sendButton = document.getElementById("send-button");
const fileInput = document.getElementById("history-file");
const resetButton = document.getElementById("reset-button");

const manualQuestions = [
  {
    question: "What are you most interested in watching right now?",
    options: [
      "A movie",
      "A TV series",
      "Either is fine",
      "Something short to watch tonight"
    ]
  },
  {
    question: "Which genres sound best to you? Pick one or describe a combination.",
    options: [
      "Thriller, mystery, or crime",
      "Sci-fi or fantasy",
      "Comedy or feel-good",
      "Drama or romance",
      "Action or adventure",
      "Documentary or true crime",
      "Anime or animation",
      "Surprise me"
    ]
  },
  {
    question: "What kind of mood or storytelling are you looking for?",
    options: [
      "Light and entertaining",
      "Dark and suspenseful",
      "Emotional and character-driven",
      "Clever, twisty, and unpredictable",
      "Immersive and escapist",
      "Something unusual or thought-provoking"
    ]
  },
  {
    question: "How intense should the experience be?",
    options: [
      "Relaxing and easy to follow",
      "Moderately engaging",
      "Complex, with lots to think about",
      "Dark, mature, or intense",
      "No strong preference"
    ]
  },
  {
    question: "What else should I prioritize or avoid?",
    options: [
      "Something highly rated or widely loved",
      "Something underrated or less obvious",
      "A short movie or limited series",
      "Avoid graphic violence or disturbing content",
      "I am open to anything"
    ]
  }
];

let state;

function resetState() {
  state = {
    flow: null,
    phase: "start",
    answers: [],
    historySummary: null,
    currentQuestion: null,
    recommendations: [],
    rejectedTitles: [],
    busy: false
  };

  messagesEl.replaceChildren();
  choicesEl.replaceChildren();
  recommendationsEl.replaceChildren();
  uploadStatusEl.textContent = "";
  answerInput.value = "";
  answerInput.placeholder = "Choose an option or type your own answer...";
  fileInput.value = "";

  appendMessage(
    "assistant",
    "Hi! I can help you find your next Netflix movie or series. Would you like to upload your Netflix viewing history so I can personalize the questions, or would you prefer to answer five quick questions instead?"
  );

  renderStartChoices();
  setBusy(false);
}

function appendMessage(role, text) {
  const message = document.createElement("div");
  message.className = `message ${role}`;

  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  message.appendChild(paragraph);

  messagesEl.appendChild(message);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  return message;
}

function setBusy(value) {
  state.busy = value;
  answerInput.disabled = value;
  sendButton.disabled = value;
  resetButton.disabled = value;

  choicesEl.querySelectorAll("button").forEach((button) => {
    button.disabled = value;
  });

  if (value) {
    uploadStatusEl.textContent = "Thinking...";
  } else if (uploadStatusEl.textContent === "Thinking...") {
    uploadStatusEl.textContent = "";
  }
}

function renderChoices(options, onSelect) {
  choicesEl.replaceChildren();

  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-button";
    button.textContent = option;
    button.addEventListener("click", () => onSelect(option));
    choicesEl.appendChild(button);
  }
}

function renderStartChoices() {
  renderChoices(
    [
      "Yes, I'll upload my Netflix history",
      "No, continue without uploading"
    ],
    (choice) => {
      if (choice.startsWith("Yes")) {
        fileInput.click();
      } else {
        startManualFlow();
      }
    }
  );
}

function startManualFlow() {
  state.flow = "manual";
  state.phase = "asking";
  state.answers = [];
  state.historySummary = null;

  choicesEl.replaceChildren();
  uploadStatusEl.textContent = "";

  appendMessage(
    "assistant",
    "No problem! You don't need to upload anything. I'll ask five questions to narrow down what you would enjoy. You can select an option or type a different answer."
  );

  askManualQuestion();
}

function askManualQuestion() {
  const index = state.answers.length;
  const item = manualQuestions[index];

  if (!item) {
    generateRecommendations();
    return;
  }

  state.phase = "asking";
  state.currentQuestion = item.question;

  appendMessage(
    "assistant",
    `Question ${index + 1} of 5: ${item.question}`
  );

  renderChoices(item.options, answerQuestion);
  answerInput.placeholder = "Or type your own answer...";
  answerInput.focus();
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") {
        i++;
      }

      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row);
      }

      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((cell) => cell.trim() !== "")) {
      rows.push(row);
    }
  }

  if (rows.length < 2) {
    throw new Error("The CSV appears to be empty or has no viewing-history rows.");
  }

  const headers = rows[0].map((header) =>
    header.replace(/^\uFEFF/, "").trim().toLowerCase()
  );

  const titleIndex = headers.findIndex((header) =>
    ["title", "name", "video title"].includes(header)
  );

  if (titleIndex === -1) {
    throw new Error(
      'I could not find a "Title" column. Please choose the viewing-activity CSV downloaded from Netflix.'
    );
  }

  const dateIndex = headers.findIndex((header) =>
    ["start time", "date", "date watched"].includes(header)
  );

  const entries = rows.slice(1).map((cells) => ({
    title: (cells[titleIndex] || "").trim(),
    date: dateIndex >= 0 ? (cells[dateIndex] || "").trim() : ""
  })).filter((entry) => entry.title);

  if (!entries.length) {
    throw new Error("No viewing titles were found in that CSV.");
  }

  const groups = new Map();

  for (const entry of entries) {
    // Netflix history may list each episode separately. Group common
    // episode formats so a series is not counted as dozens of titles.
    const baseTitle = entry.title
      .replace(/:\s*S\d+\s*:\s*E\d+.*$/i, "")
      .replace(/\s+-\s+Season\s+\d+.*$/i, "")
      .trim();

    const key = baseTitle.toLowerCase();
    const existing = groups.get(key);

    if (existing) {
      existing.count++;
      if (entry.date && (!existing.lastSeen || entry.date > existing.lastSeen)) {
        existing.lastSeen = entry.date;
      }
    } else {
      groups.set(key, {
        title: baseTitle,
        count: 1,
        lastSeen: entry.date
      });
    }
  }

  const topTitles = [...groups.values()]
    .sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return (b.lastSeen || "").localeCompare(a.lastSeen || "");
    })
    .slice(0, 80);

  return {
    totalEntries: entries.length,
    uniqueTitles: groups.size,
    topTitles
  };
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".csv")) {
    uploadStatusEl.textContent =
      "Please upload the Netflix viewing-activity CSV file.";
    fileInput.value = "";
    return;
  }

  try {
    uploadStatusEl.textContent = "Reading your viewing history...";

    const text = await file.text();
    state.historySummary = parseCSV(text);
    state.flow = "history";
    state.phase = "asking";
    state.answers = [];
    state.rejectedTitles = [];

    choicesEl.replaceChildren();

    appendMessage(
      "user",
      `I've uploaded my Netflix history (${state.historySummary.totalEntries} viewing entries).`
    );

    appendMessage(
      "assistant",
      "Thanks! I'll use your viewing history to ask three more specific questions, then make recommendations."
    );

    uploadStatusEl.textContent =
      `Read ${state.historySummary.totalEntries} viewing entries and found ${state.historySummary.uniqueTitles} distinct titles.`;

    await askHistoryQuestion();
  } catch (error) {
    state.historySummary = null;
    state.flow = null;
    state.phase = "start";

    uploadStatusEl.textContent = error.message;

    appendMessage(
      "assistant",
      "I couldn't use that file. You can try another CSV or continue without uploading your history."
    );

    renderChoices(
      ["Try another CSV", "Continue without uploading"],
      (choice) => {
        if (choice === "Try another CSV") {
          fileInput.click();
        } else {
          startManualFlow();
        }
      }
    );
  }
});

async function callRecommendationAPI(payload) {
  const response = await fetch("/api/recommend", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }

  return data;
}

async function askHistoryQuestion() {
  setBusy(true);
  choicesEl.replaceChildren();

  try {
    const data = await callRecommendationAPI({
      action: "historyQuestion",
      historySummary: state.historySummary,
      answers: state.answers,
      questionNumber: state.answers.length + 1
    });

    state.currentQuestion = data.question;
    state.phase = "asking";

    appendMessage(
      "assistant",
      `Personalized question ${state.answers.length + 1} of 3: ${data.question}`
    );

    renderChoices(
      Array.isArray(data.options) && data.options.length
        ? data.options
        : ["Yes", "No", "No preference"],
      answerQuestion
    );

    answerInput.placeholder = "Or type your own answer...";
  } catch (error) {
    appendMessage(
      "assistant",
      `I couldn't generate the next question: ${error.message} You can try again or restart.`
    );

    renderChoices(
      ["Try again", "Start over"],
      (choice) => {
        if (choice === "Try again") {
          askHistoryQuestion();
        } else {
          resetState();
        }
      }
    );
  } finally {
    setBusy(false);
  }
}

function answerQuestion(answer) {
  if (state.busy || state.phase !== "asking") return;

  const cleanAnswer = String(answer || "").trim();
  if (!cleanAnswer) return;

  appendMessage("user", cleanAnswer);
  choicesEl.replaceChildren();
  answerInput.value = "";

  state.answers.push({
    question: state.currentQuestion,
    answer: cleanAnswer
  });

  state.currentQuestion = null;

  if (state.flow === "history") {
    if (state.answers.length >= 3) {
      generateRecommendations();
    } else {
      askHistoryQuestion();
    }
  } else if (state.flow === "manual") {
    if (state.answers.length >= 5) {
      generateRecommendations();
    } else {
      askManualQuestion();
    }
  }
}

function renderRecommendations(data) {
  recommendationsEl.replaceChildren();

  const items = Array.isArray(data.recommendations)
    ? data.recommendations
    : [];

  for (const item of items) {
    const card = document.createElement("article");
    card.className = "recommendation-card";

    const type = document.createElement("div");
    type.className = "recommendation-type";
    type.textContent = item.type || "Netflix pick";

    const title = document.createElement("h3");
    title.textContent = item.title || "Untitled recommendation";

    const genres = document.createElement("div");
    genres.className = "recommendation-genres";
    genres.textContent = item.genres || "";

    const reason = document.createElement("p");
    reason.textContent = item.why || "Suggested based on your preferences.";

    card.append(type, title, genres, reason);

    if (item.match) {
      const match = document.createElement("span");
      match.className = "match-label";
      match.textContent = item.match;
      card.appendChild(match);
    }

    if (item.availabilityNote) {
      const availability = document.createElement("p");
      availability.textContent = item.availabilityNote;
      card.appendChild(availability);
    }

    recommendationsEl.appendChild(card);
  }
}

async function generateRecommendations(feedback = "") {
  setBusy(true);
  state.phase = "recommending";
  choicesEl.replaceChildren();
  recommendationsEl.replaceChildren();

  appendMessage(
    "assistant",
    feedback
      ? "Got it. I'll adjust the picks and try a different set."
      : "Putting your preferences together and finding your next watch..."
  );

  try {
    const data = await callRecommendationAPI({
      action: "recommend",
      historySummary: state.historySummary,
      answers: state.answers,
      feedback,
      rejectedTitles: state.rejectedTitles
    });

    const items = Array.isArray(data.recommendations)
      ? data.recommendations
      : [];

    if (!items.length) {
      throw new Error("The AI did not return any recommendations. Please try again.");
    }

    state.recommendations = items;
    state.rejectedTitles = [
      ...new Set([
        ...state.rejectedTitles,
        ...items.map((item) => item.title).filter(Boolean)
      ])
    ];

    appendMessage(
      "assistant",
      data.intro || "Here are some recommendations based on your answers."
    );

    renderRecommendations(data);
    state.phase = "feedback";

    appendMessage(
      "assistant",
      "How do these look? You can tell me what you liked or disliked, or ask for a different set."
    );

    renderChoices(
      ["Give me a different set", "I'm happy with these", "Start over"],
      (choice) => {
        if (choice === "Give me a different set") {
          generateRecommendations(
            "Suggest a substantially different set of titles. Avoid all titles previously recommended."
          );
        } else if (choice === "I'm happy with these") {
          choicesEl.replaceChildren();
          appendMessage(
            "assistant",
            "Enjoy your next watch! If you want more ideas later, choose Start over."
          );
          state.phase = "finished";
          renderChoices(["Start over"], resetState);
        } else {
          resetState();
        }
      }
    );

    answerInput.placeholder =
      "Tell me what you liked, disliked, or want to change...";
  } catch (error) {
    appendMessage(
      "assistant",
      `I couldn't finish the recommendations: ${error.message}`
    );

    renderChoices(
      ["Try recommendations again", "Start over"],
      (choice) => {
        if (choice === "Try recommendations again") {
          generateRecommendations();
        } else {
          resetState();
        }
      }
    );
  } finally {
    setBusy(false);
  }
}

answerForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (state.busy) return;

  const text = answerInput.value.trim();
  if (!text) return;

  if (state.phase === "asking") {
    answerQuestion(text);
  } else if (state.phase === "feedback") {
    appendMessage("user", text);
    answerInput.value = "";
    generateRecommendations(text);
  }
});

resetButton.addEventListener("click", resetState);

resetState();
