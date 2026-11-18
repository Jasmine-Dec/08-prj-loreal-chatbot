/* DOM elements */
const chatForm = document.getElementById("chatForm");
const userInput = document.getElementById("userInput");
const chatWindow = document.getElementById("chatWindow");
const sendBtn = document.getElementById("sendBtn");

// Replace this URL with your class-hosted Cloudflare Worker URL (see README.md).
// Never put your OpenAI API key in client-side JavaScript — the Worker stores it safely as a secret.
const workerUrl = "https://loreal-chatbot.your-subdomain.workers.dev/";

// Store the conversation history so the assistant remembers context
const messages = [
  {
    role: "system",
    content:
      "You are a helpful L'Oréal beauty advisor. Help users discover L'Oréal makeup, skincare, haircare, and fragrance products and build personalized routines.",
  },
];

// Escape HTML characters so user input and API text render safely as plain text
function escapeHTML(text) {
  const temp = document.createElement("div");
  temp.textContent = text;
  return temp.innerHTML;
}

// Render a sender label and message body inside a message element
function renderMessage(messageEl, sender, text) {
  const label = sender === "user" ? "You" : "L'Oréal Advisor";
  const cleanText = text.trim();

  messageEl.className = `msg ${sender}`;
  messageEl.innerHTML = `<strong>${label}:</strong> ${escapeHTML(cleanText)}`;

  // Keep the newest response visible in the chat window
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Create and append a new message to the chat window
function addMessage(sender, text) {
  const messageEl = document.createElement("div");
  chatWindow.appendChild(messageEl);
  renderMessage(messageEl, sender, text);
  return messageEl;
}

// Set initial greeting message when the page loads
addMessage("ai", "👋 Hello! How can I help you with L'Oréal products or routines today?");

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

  // Display the captured user message clearly in the chat window
  addMessage("user", userMessage);

  // Add the user's message to the conversation history
  messages.push({ role: "user", content: userMessage });

  // Clear the input field and keep focus ready for the next message
  userInput.value = "";
  userInput.focus();

  // Disable the send button while waiting so requests don't overlap
  sendBtn.disabled = true;

  // Show a temporary loading message while waiting for the API response
  const responseEl = addMessage("ai", "Thinking...");

  try {
    // Send the messages array to the Cloudflare Worker (which forwards it to OpenAI)
    const response = await fetch(workerUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4.1",
        messages: messages,
      }),
    });

    // Check if the HTTP request succeeded
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}`);
    }

    // Parse the JSON response and extract the assistant's reply
    const data = await response.json();

    // Surface API errors if the Worker returned an OpenAI error object
    if (data.error?.message) {
      throw new Error(data.error.message);
    }

    const reply = data.choices?.[0]?.message?.content;

    if (!reply) {
      throw new Error("No reply returned from the API.");
    }

    // Replace the loading message with the formatted chatbot response and scroll into view
    renderMessage(responseEl, "ai", reply);

    // Save the assistant's reply to the conversation history
    messages.push({ role: "assistant", content: reply });
  } catch (error) {
    console.error("Error fetching chat response:", error);
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
