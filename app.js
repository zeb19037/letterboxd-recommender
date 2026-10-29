
const messagesEl = document.getElementById("messages");
const choicesEl = document.getElementById("choices");
const statusEl = document.getElementById("upload-status");
const answerForm = document.getElementById("answer-form");
const answerInput = document.getElementById("answer-input");
const sendButton = document.getElementById("send-button");
const resetButton = document.getElementById("reset-button");

const MAX_MESSAGE_LENGTH = 2000;
const MAX_HISTORY_MESSAGES = 24;

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

const emptyProfile = () => ({
  favoriteFilms: [],
  favoriteDirectors: [],
  preferredGenres: [],
  avoidedGenres: [],
  preferredThemes: [],
  preferredMoods: [],
  contentBoundaries: [],
  seenFilms: [],
  dislikedRecommendations: []
});

let state;

function resetState() {
  state = {
    messages: [],
    tasteProfile: emptyProfile(),
    busy: false
  };

  messagesEl.replaceChildren();
  choicesEl.replaceChildren();
  statusEl.textContent = "";
  answerInput.value = "";
  answerInput.disabled = false;
  answerInput.placeholder =
    "Talk about a film, explore cinema, or find something to watch...";
  sendButton.disabled = false;

  appendMessage(
    "assistant",
    "Hey! I'm Netty, your AI film conversation companion. 🍿 " +
    "We can talk about films you love, explore directors and genres, " +
    "or find something new to watch. You don't need to upload any " +
    "viewing history. What's on your mind?"
  );

  state.messages.push({
    role: "assistant",
    text: messagesEl.lastElementChild.textContent
  });

  renderChoices([
    "Recommend a film",
    "Discuss a movie I love",
    "Explore a director",
    "Find something unusual"
  ]);

  answerInput.focus();
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

function renderChoices(options) {
  choicesEl.replaceChildren();

  for (const option of options) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "choice-button";
    button.textContent = option;

    button.addEventListener("click", () => {
      sendMessage(option);
    });

    choicesEl.appendChild(button);
  }
}

function setBusy(busy) {
  state.busy = busy;
  answerInput.disabled = busy;
  sendButton.disabled = busy;
  resetButton.disabled = busy;

  choicesEl.querySelectorAll("button").forEach((button) => {
    button.disabled = busy;
  });

  statusEl.textContent = busy ? "Netty is thinking..." : "";

  if (busy) {
    statusEl.setAttribute("role", "status");
  }
}

async function sendMessage(rawText) {
  const text = String(rawText || "")
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);

  if (!text || state.busy) return;

  answerInput.value = "";
  choicesEl.replaceChildren();

  appendMessage("user", text);

  state.messages.push({
    role: "user",
    text
  });

  // Keep enough recent context for follow-up questions.
  state.messages = state.messages.slice(-MAX_HISTORY_MESSAGES);

  setBusy(true);

  try {
    const response = await fetch("/api/recommend", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "chat",
        messages: state.messages,
        tasteProfile: state.tasteProfile
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(
        data.error || `The server returned an error (${response.status}).`
      );
    }

    if (typeof data.reply !== "string" || !data.reply.trim()) {
      throw new Error("Netty returned an empty response.");
    }

    appendMessage("assistant", data.reply.trim());

    state.messages.push({
      role: "assistant",
      text: data.reply.trim()
    });

    state.messages = state.messages.slice(-MAX_HISTORY_MESSAGES);

    updateTasteProfile(data.profileUpdates);

    renderChoices([
      "Recommend something",
      "Tell me more",
      "Try a different direction"
    ]);
  } catch (error) {
    console.error("Netty request failed:", error);

    appendMessage(
      "assistant",
      "Sorry, I couldn't get a response just now. Your earlier " +
      "messages are still here. Please try sending your message again."
    );

    renderChoices(["Try again"]);

    // Retry the last message without duplicating it in the conversation.
    const retryButton = choicesEl.querySelector("button");

    if (retryButton) {
      retryButton.addEventListener("click", () => {
        const lastUserMessage = [...state.messages]
          .reverse()
          .find((message) => message.role === "user");

        if (lastUserMessage) {
          // Remove the failed turn from history before retrying.
          state.messages = state.messages.filter(
            (message) => message !== lastUserMessage
          );

          // Remove the error message from the visible chat.
          messagesEl.lastElementChild?.remove();

          sendMessage(lastUserMessage.text);
        }
      }, { once: true });
    }
  } finally {
    setBusy(false);
    answerInput.focus();
  }
}

function updateTasteProfile(updates) {
  if (!updates || typeof updates !== "object") return;

  for (const key of PROFILE_KEYS) {
    if (!Array.isArray(updates[key])) continue;

    const existing = state.tasteProfile[key] || [];
    const incoming = updates[key]
      .filter((value) => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 20);

    const unique = new Map();

    for (const value of [...existing, ...incoming]) {
      unique.set(value.toLowerCase(), value);
    }

    state.tasteProfile[key] = [...unique.values()].slice(-30);
  }
}

answerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(answerInput.value);
});

// Enter sends the message. Shift+Enter inserts a new line.
answerInput.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    answerForm.requestSubmit();
  }
});

resetButton.addEventListener("click", resetState);

// Start with a clean, conversational session.
resetState();
