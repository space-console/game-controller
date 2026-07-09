// Space Console controller — entry point.
//
// Two screens: a join form (enter the TV's room code) and a control pad that
// turns taps into normalized intents and sends them through ControllerSession.
// Placeholder UX over a stubbed transport — wire a real transport in session.js.

import { ControllerSession } from "./session.js?v=d2504ab2-2dda-4c64-8414-5af0025f0675";

const session = new ControllerSession();

const joinView = document.getElementById("join");
const padView = document.getElementById("pad");
const joinForm = document.getElementById("joinForm");
const codeInput = document.getElementById("codeInput");
const nameInput = document.getElementById("nameInput");
const joinStatus = document.getElementById("joinStatus");

// Remember the player's name across sessions so they don't retype it. It rides
// along on join and becomes their label on the TV roster + high-score tables.
const SAVED_NAME_KEY = "sc.playerName";
try { nameInput.value = localStorage.getItem(SAVED_NAME_KEY) || ""; } catch { /* private mode */ }
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
  const name = nameInput.value.trim();
  try { localStorage.setItem(SAVED_NAME_KEY, name); } catch { /* private mode */ }
  joinStatus.textContent = "Connecting…";
  try {
    session.connect(code, name);
  } catch (err) {
    // Surface a synchronous failure (e.g. RTCPeerConnection rejecting the ICE
    // config) instead of hanging silently on "Connecting…".
    joinStatus.textContent = "Error: " + (err && err.message ? err.message : String(err));
    console.error("[controller] connect failed", err);
  }
});

session.addEventListener("ready", (e) => {
  padRoom.textContent = `Room ${e.detail.roomCode}`;
  renderControls(DEFAULT_CONTROLS); // until the TV sends the real layout
  joinView.hidden = true;
  padView.hidden = false;
});

// The TV tells us which buttons to show (menu pad, or a game's custom layout).
session.addEventListener("controls", (e) => renderControls(e.detail));

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
const padDpad = document.getElementById("padDpad");
const padActions = document.getElementById("padActions");

// Layout used until the TV sends the real one (menu / game-specific).
const DEFAULT_CONTROLS = { profile: "dpad", buttons: [{ id: "enter", label: "OK" }] };

function emit(intent) {
  session.send(intent);
  padLog.textContent = `▸ ${intent}`;
}

// The d-pad is static; wire it once.
for (const btn of padDpad.querySelectorAll("[data-intent]")) {
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    btn.classList.add("is-active");
    emit(btn.dataset.intent);
  });
  btn.addEventListener("pointerup", () => btn.classList.remove("is-active"));
  btn.addEventListener("pointercancel", () => btn.classList.remove("is-active"));
}

// Action buttons are rebuilt whenever the TV sends a layout. Back is always
// appended. `hold` buttons emit `<id>` on press and `<id>:release` on release
// (e.g. pinball flippers).
function renderControls(ctl) {
  const profile = ctl && ctl.profile === "buttons" ? "buttons" : "dpad";
  const buttons = (ctl && ctl.buttons) || [];
  padDpad.hidden = profile !== "dpad";
  padActions.innerHTML = "";
  for (const b of buttons) padActions.appendChild(makeAction(b));
  padActions.appendChild(makeAction({ id: "back", label: "Back", sys: true }));
}

function makeAction(b) {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "action" + (b.sys ? " action--sys" : "");
  el.dataset.intent = b.id;
  el.textContent = b.label;
  el.setAttribute("aria-label", b.label);
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.classList.add("is-active");
    emit(b.id);
  });
  const release = () => {
    if (!el.classList.contains("is-active")) return;
    el.classList.remove("is-active");
    if (b.hold) emit(b.id + ":release");
  };
  el.addEventListener("pointerup", release);
  el.addEventListener("pointerleave", release);
  el.addEventListener("pointercancel", release);
  return el;
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
