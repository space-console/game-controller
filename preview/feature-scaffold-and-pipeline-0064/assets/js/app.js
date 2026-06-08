// Space Console controller — entry point.
//
// Two screens: a join form (enter the TV's room code) and a control pad that
// turns taps into normalized intents and sends them through ControllerSession.
// Placeholder UX over a stubbed transport — wire a real transport in session.js.

import { ControllerSession } from "./session.js?v=6cd23204-5a1a-46ab-8404-3de07b32bfe9";

const session = new ControllerSession();

const joinView = document.getElementById("join");
const padView = document.getElementById("pad");
const joinForm = document.getElementById("joinForm");
const codeInput = document.getElementById("codeInput");
const joinStatus = document.getElementById("joinStatus");
const padRoom = document.getElementById("padRoom");
const padLog = document.getElementById("padLog");
const leaveBtn = document.getElementById("leaveBtn");

// ---- Join flow ------------------------------------------------------------
joinForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const code = codeInput.value.trim().toUpperCase();
  if (code.length < 4) {
    joinStatus.textContent = "Enter the 4-character code from the TV.";
    return;
  }
  joinStatus.textContent = "Connecting…";
  session.connect(code);
});

session.addEventListener("ready", (e) => {
  padRoom.textContent = `Room ${e.detail.roomCode}`;
  joinView.hidden = true;
  padView.hidden = false;
});

session.addEventListener("closed", () => {
  padView.hidden = true;
  joinView.hidden = false;
  joinStatus.textContent = "";
  codeInput.value = "";
});

// ---- Control pad ----------------------------------------------------------
// Every control routes through one intent stream, just like the launcher's
// input layer — the UI never talks to the transport directly.
function emit(intent) {
  session.send(intent);
  padLog.textContent = `▸ ${intent}`;
}

for (const btn of padView.querySelectorAll("[data-intent]")) {
  // pointerdown for snappy, touch-friendly response.
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    btn.classList.add("is-active");
    emit(btn.dataset.intent);
  });
  btn.addEventListener("pointerup", () => btn.classList.remove("is-active"));
  btn.addEventListener("pointercancel", () => btn.classList.remove("is-active"));
}

leaveBtn.addEventListener("click", () => session.disconnect());
