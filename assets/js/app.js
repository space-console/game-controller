// Space Console controller — entry point.
//
// Two screens: a join form (enter the TV's room code) and a control pad that
// turns taps into normalized intents and sends them through ControllerSession.
// Placeholder UX over a stubbed transport — wire a real transport in session.js.

import { ControllerSession } from "./session.js?v=ee4b33e0-c647-45aa-a708-b0da4ff2eb1d";

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
  try {
    session.connect(code);
  } catch (err) {
    // Surface a synchronous failure (e.g. RTCPeerConnection rejecting the ICE
    // config) instead of hanging silently on "Connecting…".
    joinStatus.textContent = "Error: " + (err && err.message ? err.message : String(err));
    console.error("[controller] connect failed", err);
  }
});

session.addEventListener("ready", (e) => {
  padRoom.textContent = `Room ${e.detail.roomCode}`;
  joinView.hidden = true;
  padView.hidden = false;
});

session.addEventListener("closed", () => {
  padView.hidden = true;
  joinView.hidden = false;
  codeInput.value = "";
});

session.addEventListener("error", (e) => {
  // Stay on the join screen and explain why the handshake didn't complete.
  joinStatus.textContent =
    e.detail.reason === "no-room"
      ? "No TV found for that code."
      : "Couldn’t connect — check the code and that the TV is online.";
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

leaveBtn.addEventListener("click", () => {
  joinStatus.textContent = "";
  session.disconnect();
});

// ---- Auto-join from a scanned QR -------------------------------------------
// The launcher's QR encodes ?room=<code>; when present, pre-fill and submit so
// scanning the TV drops the phone straight onto the pad — no typing.
const scannedRoom = new URLSearchParams(location.search).get("room");
if (scannedRoom) {
  codeInput.value = scannedRoom.trim().toUpperCase();
  if (typeof joinForm.requestSubmit === "function") joinForm.requestSubmit();
  else joinForm.dispatchEvent(new Event("submit", { cancelable: true }));
}
