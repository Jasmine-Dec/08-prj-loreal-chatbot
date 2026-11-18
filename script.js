/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");

// Replace this URL with your class-hosted Cloudflare Worker URL (see README.md).
// Never put your OpenAI API key in client-side JavaScript — the Worker stores it safely as a secret.
const workerUrl = "https://lorealchatbot.jasmined1256.workers.dev/";

// Initial greeting shown when the chat loads
const initialGreeting =
  "👋 Hello! How can I help you with L'Oréal products or routines today?";

// Track key details across the conversation so the chatbot remembers context naturally
const conversationState = {
  userName: null,
  pastQuestions: [],
};

// Maximum number of user/assistant messages to keep in active history
const MAX_HISTORY_MESSAGES = 20;

// Build the system prompt dynamically with remembered user details and past questions
function buildSystemPrompt() {
  let prompt =
    "You are a helpful L'Oréal beauty advisor. Help users discover L'Oréal makeup, skincare, haircare, and fragrance products and build personalized routines. Track the full context of the conversation—including the user's name, preferences, and earlier questions—so follow-up replies feel natural and personalized. Keep your responses concise, well-structured, and complete within about 150–200 words so they never cut off mid-sentence.";

  if (conversationState.userName) {
    prompt += ` The user's name is ${conversationState.userName}.`;
  }

  if (conversationState.pastQuestions.length > 0) {
    const recentQuestions = conversationState.pastQuestions
      .slice(-5)
      .join(" | ");
    prompt += ` Earlier user messages in this conversation: ${recentQuestions}.`;
  }

  return prompt;
}

// Store the conversation history so the assistant remembers multi-turn context
const messages = [
  {
    role: "system",
    content: buildSystemPrompt(),
  },
  {
    role: "assistant",
    content: initialGreeting,
  },
];

// Extract details like the user's name and log past questions from each user turn
function updateConversationContext(userMessage) {
  // Look for common ways a user introduces their name
  const nameMatch = userMessage.match(
    /(?:my name is|call me|(?:^|[.!?,]\s*)(?:hi|hello|hey)[,!\s]+i(?:'m| am))\s+([A-Za-z][A-Za-z'-]{1,24})\b/i,
  );

  const nonNames = new Set([
    "looking",
    "trying",
    "interested",
    "having",
    "getting",
    "using",
    "asking",
    "wondering",
    "hoping",
    "new",
    "here",
    "not",
    "so",
    "very",
    "really",
    "just",
    "good",
    "fine",
  ]);

  if (nameMatch && !nonNames.has(nameMatch[1].toLowerCase())) {
    const rawName = nameMatch[1];
    conversationState.userName =
      rawName.charAt(0).toUpperCase() + rawName.slice(1);
  }

  // Record each user message so earlier questions remain tracked
  conversationState.pastQuestions.push(userMessage);

  // Refresh the system prompt with the latest remembered context
  messages[0].content = buildSystemPrompt();
}

// Keep the system prompt plus the most recent conversation turns if history grows long
function getMessagesForRequest() {
  if (messages.length <= MAX_HISTORY_MESSAGES + 1) {
    return messages;
  }

  const systemMessage = messages[0];
  const recentMessages = messages.slice(-MAX_HISTORY_MESSAGES);
  return [systemMessage, ...recentMessages];
}

// Escape HTML characters so user input and API text render safely as plain text
function escapeHTML(text) {
  const temp = document.createElement("div");
  temp.textContent = text;
  return temp.innerHTML;
}

// Render a sender label and message body inside a message bubble element
function renderMessage(messageEl, sender, text, isLoading = false) {
  const label = sender === "user" ? "You" : "L'Oréal Advisor";
  const cleanText = text.trim();

  messageEl.className = isLoading
    ? `msg ${sender} is-loading`
    : `msg ${sender}`;
  messageEl.innerHTML = `<span class="msg-sender">${label}</span><div class="msg-text">${escapeHTML(cleanText)}</div>`;

  // Keep the newest message bubble visible at the bottom
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Create and append a new message bubble to the chat window
function addMessage(sender, text, isLoading = false) {
  const messageEl = document.createElement("div");
  chatWindow.appendChild(messageEl);
  renderMessage(messageEl, sender, text, isLoading);
  return messageEl;
}

// Set initial greeting message when the page loads
addMessage("ai", initialGreeting);

/* Handle form submit */
chatForm.addEventListener("submit", async (e) => {
  // Prevent the page from reloading when the form is submitted
  e.preventDefault();

  // Capture the user's text from the input field and remove extra spaces
  const userMessage = userInput.value.trim();

  // Stop if the input is empty
  if (!userMessage) {
    return;
  }

  // Append the user's message bubble to the conversation thread
  addMessage("user", userMessage);

  // Update tracked context (name, past questions) and add this turn to messages
  updateConversationContext(userMessage);
  messages.push({ role: "user", content: userMessage });

  // Clear the input field and keep focus ready for the next message
  userInput.value = "";
  userInput.focus();

  // Disable the send button while waiting so requests don't overlap
  sendBtn.disabled = true;

  // Show a temporary loading bubble while waiting for the API response
  const responseEl = addMessage("ai", "Thinking...", true);

  // Helper to send a messages array to the Cloudflare Worker and return the choice text + finishReason
  async function requestCompletion(messageList) {
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1",
        messages: messageList,
      }),
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    const data = await response.json();

    if (data.error?.message) {
      throw new Error(data.error.message);
    }

    const choice = data.choices?.[0];
    const text = choice?.message?.content;

    if (!text) {
      throw new Error("No reply returned from the API.");
    }

    return {
      text,
      finishReason: choice.finish_reason,
    };
  }

  try {
    // Send the full conversation history to the Cloudflare Worker
    const requestMessages = getMessagesForRequest();
    let result = await requestCompletion(requestMessages);
    let fullReply = result.text;

    // If the Worker's max_completion_tokens limit cut off the reply, seamlessly fetch the rest
    let continuations = 0;
    while (result.finishReason === "length" && continuations < 2) {
      continuations += 1;
      renderMessage(responseEl, "ai", `${fullReply} ...`);

      const continuationMessages = [
        ...requestMessages,
        { role: "assistant", content: fullReply },
        {
          role: "user",
          content:
            "Continue directly from your exact last word without repeating earlier text, and finish your answer concisely.",
        },
      ];

      result = await requestCompletion(continuationMessages);
      const separator = /[\s\n]$/.test(fullReply) ? "" : " ";
      fullReply = `${fullReply}${separator}${result.text.trimStart()}`;
    }

    // Replace the loading message with the complete chatbot response and scroll into view
    renderMessage(responseEl, "ai", fullReply);

    // Save the complete assistant reply to the conversation history for future turns
    messages.push({ role: "assistant", content: fullReply });
  } catch (error) {
    console.error("Error fetching chat response:", error);

    // Remove the failed user message from history so conversation state stays clean
    messages.pop();
    conversationState.pastQuestions.pop();
    messages[0].content = buildSystemPrompt();

    renderMessage(
      responseEl,
      "ai",
      "Sorry, I couldn't reach the chatbot service. Check your Cloudflare Worker URL in script.js (see README.md).",
    );
  } finally {
    // Re-enable the send button after the request finishes
    sendBtn.disabled = false;
  }
});
