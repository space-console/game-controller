// Space Console controller — entry point.
//
// Two screens: a join form (enter the TV's room code) and a control pad that
// turns taps into normalized intents and sends them through ControllerSession.
// Placeholder UX over a stubbed transport — wire a real transport in session.js.

import { ControllerSession } from "./session.js?v=79c2310d-6a06-40a0-a6e4-dfc31cd46dbe";

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

// Remember the room for THIS tab only (sessionStorage), so backgrounding the tab
// or a bfcache reload can silently rejoin the same room instead of dumping the
// player back to a blank join form. Cleared only on an explicit Leave.
const SAVED_ROOM_KEY = "sc.roomCode";
function saveRoom(code) { try { sessionStorage.setItem(SAVED_ROOM_KEY, code); } catch { /* private mode */ } }
function savedRoom() { try { return sessionStorage.getItem(SAVED_ROOM_KEY); } catch { return null; } }
function clearRoom() { try { sessionStorage.removeItem(SAVED_ROOM_KEY); } catch { /* private mode */ } }
const padRoom = document.getElementById("padRoom");
const padLog = document.getElementById("padLog");
const leaveBtn = document.getElementById("leaveBtn");
const reconnectBanner = document.getElementById("reconnectBanner");

// Toggle the top "Reconnecting…" banner shown while a dropped session rejoins.
function showReconnecting(on) { reconnectBanner.hidden = !on; }

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
  showReconnecting(false); // back on-air — clear any reconnect banner
  saveRoom(e.detail.roomCode); // remember it so a background/return can rejoin
  padRoom.textContent = `Room ${e.detail.roomCode}`;
  renderControls(DEFAULT_CONTROLS); // until the TV sends the real layout
  joinView.hidden = true;
  padView.hidden = false;
});

// The TV tells us which buttons to show (menu pad, or a game's custom layout).
session.addEventListener("controls", (e) => renderControls(e.detail));

session.addEventListener("closed", (e) => {
  // An explicit Leave: forget the room and return to the join form.
  if (e.detail && e.detail.intentional) {
    showReconnecting(false);
    clearRoom();
    padView.hidden = true;
    joinView.hidden = false;
    codeInput.value = "";
    return;
  }
  // An unintentional drop (tab backgrounded, network blip): stay on the pad and
  // try to rejoin the same room right away. visibilitychange/pageshow below also
  // retry when the user returns to the tab, in case this immediate attempt was
  // made while still suspended.
  padLog.textContent = "Reconnecting…";
  reconnect();
});

session.addEventListener("error", (e) => {
  // A reconnect couldn't complete (e.g. the TV is gone) — stop implying progress.
  // A later return-to-tab (visibilitychange) will try again.
  showReconnecting(false);
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

// ---- Reconnect on return ---------------------------------------------------
// Mobile browsers suspend/tear down a backgrounded tab's WebRTC + WebSocket. On
// return we silently rejoin the saved room with the saved name — the TV restores
// the player's seat by name, so it's as if they never left.
function reconnect() {
  if (session.connected) return; // already live — nothing to do
  const code = savedRoom();
  if (!code) return; // never joined, or explicitly left
  const name = (nameInput.value || "").trim();
  showReconnecting(true);
  joinStatus.textContent = "Reconnecting…";
  try { session.connect(code, name); } catch (err) {
    console.error("[controller] reconnect failed", err);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") reconnect();
});
// Fires on bfcache restore (back/forward or resurrected tab) where
// visibilitychange may not.
window.addEventListener("pageshow", (e) => { if (e.persisted) reconnect(); });

// ---- Auto-join from a scanned QR -------------------------------------------
// The launcher's QR encodes ?room=<code>; when present, pre-fill and submit so
// scanning the TV drops the phone straight onto the pad — no typing.
const scannedRoom = new URLSearchParams(location.search).get("room");
if (scannedRoom) {
  codeInput.value = scannedRoom.trim().toUpperCase();
  if (typeof joinForm.requestSubmit === "function") joinForm.requestSubmit();
  else joinForm.dispatchEvent(new Event("submit", { cancelable: true }));
}
