// Space Console controller — entry point.
//
// Two screens: a join form (enter the TV's room code) and a control pad that
// turns taps into normalized intents and sends them through ControllerSession.
// Placeholder UX over a stubbed transport — wire a real transport in session.js.

import { ControllerSession } from "./session.js?v=895dfcb4-8b36-4d36-9b26-57ee7c42fec0";

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
  const profile =
    ctl && (ctl.profile === "buttons" || ctl.profile === "analog") ? ctl.profile : "dpad";
  const buttons = (ctl && ctl.buttons) || [];
  padDpad.hidden = profile !== "dpad";
  setAnalog(profile === "analog"); // landscape steering + pedals for driving games
  // Aux buttons sit in the LEFT column of the analog pad, else in the normal row.
  const target = profile === "analog" ? analog.aux : padActions;
  padActions.innerHTML = "";
  if (analog) analog.aux.innerHTML = "";
  for (const b of buttons) target.appendChild(makeAction(b));
  target.appendChild(makeAction({ id: "back", label: "Back", sys: true }));
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

// ---- Analog driving pad ----------------------------------------------------
// For driving games (profile:"analog"). A steering track the left thumb drags
// (-1..1, self-centering) plus gas/brake/drift pedals for the right thumb, sent
// as a continuous frame via session.sendAnalog(). An optional tilt mode steers
// from the phone's gyroscope instead of the track. The declared aux buttons
// (power-up, reset, …) still render in padActions alongside.
const padControls = document.querySelector(".pad__controls");
let analog = null;            // lazily-built DOM + wiring
const drive = { steer: 0, gas: false, brake: false, drift: false };
let driveDirty = false;       // a frame is pending; coalesced to one send per rAF
let driveActive = false;      // analog profile is showing → run the send loop
let steerPointer = null;      // active steering pointer id (null = not steering)
let tiltOn = false;
let tiltCenter = null;        // gyro reading captured as "straight" when tilt enables

function setAnalog(on) {
  if (on) ensureAnalog();
  if (analog) analog.root.hidden = !on;
  padControls.classList.toggle("pad__controls--drive", on); // landscape driving layout
  if (on && !driveActive) {
    driveActive = true;
    requestAnimationFrame(driveLoop);
  } else if (!on && driveActive) {
    driveActive = false;
    resetDrive();
    disableTilt();
    session.sendAnalog(0, 0, 0, false); // release the car when leaving the pad
  }
}

function resetDrive() {
  drive.steer = 0; drive.gas = false; drive.brake = false; drive.drift = false;
  steerPointer = null;
  if (analog) {
    setKnob(0);
    for (const p of analog.pedals) p.el.classList.remove("is-active");
  }
}

// One coalesced frame per animation tick while the car has focus — enough for
// smooth steering without flooding the data channel.
function driveLoop() {
  if (!driveActive) return;
  if (driveDirty) {
    // BRAKE = reverse/brake: negative throttle brakes while moving forward, then
    // reverses once stopped (the runtime handles the transition). Sending a
    // service brake too would pin the car and block reverse — so we don't.
    const throttle = drive.gas ? 1 : drive.brake ? -1 : 0;
    session.sendAnalog(drive.steer, throttle, 0, drive.drift);
    driveDirty = false;
  }
  requestAnimationFrame(driveLoop);
}
function markDrive() { driveDirty = true; }

// Radius the knob can travel from the stick centre.
function knobRadius() {
  if (!analog) return 0;
  const d = Math.min(analog.track.clientWidth, analog.track.clientHeight);
  return d * 0.5 - 26;
}

// Position the knob for a given steer value (used by tilt + self-centering).
function setKnob(steer) {
  drive.steer = Math.max(-1, Math.min(1, steer));
  if (analog) {
    const x = drive.steer * knobRadius();
    analog.knob.style.transform = `translate(calc(-50% + ${x}px), -50%)`;
  }
}

// Virtual thumbstick: the knob follows the finger within a circle; steering is
// the horizontal component. Self-centers on release.
function stickFromEvent(e) {
  const rect = analog.track.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const r = Math.min(rect.width, rect.height) * 0.5 - 26 || 1;
  let dx = e.clientX - cx;
  let dy = e.clientY - cy;
  const mag = Math.hypot(dx, dy);
  if (mag > r) { dx = (dx / mag) * r; dy = (dy / mag) * r; }
  drive.steer = expoSteer(Math.max(-1, Math.min(1, dx / r)));
  analog.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  markDrive();
}

// Mild steering expo: softens the mid-range so the car turns a bit less sharply,
// while full stick deflection still reaches full lock. The knob position stays
// linear to the thumb; only the transmitted steer is eased.
function expoSteer(v) {
  const k = 1.35;
  return Math.sign(v) * Math.pow(Math.abs(v), k);
}

function ensureAnalog() {
  if (analog) return;
  const root = document.createElement("div");
  root.className = "pad__analog";
  // Landscape driving surface: buttons on the LEFT, steering on the RIGHT.
  root.innerHTML = `
    <div class="drive">
      <div class="drivecol drivecol--left">
        <div class="pedals" role="group" aria-label="Pedals">
          <button class="pedal pedal--gas" data-pedal="gas" type="button">GAS</button>
          <button class="pedal pedal--brake" data-pedal="brake" type="button">BRAKE</button>
          <button class="pedal pedal--drift" data-pedal="drift" type="button">DRIFT</button>
        </div>
        <div class="pad__actions pad__actions--aux" id="analogAux" role="group" aria-label="Actions"></div>
      </div>
      <div class="drivecol drivecol--right steer" aria-label="Steering">
        <button class="steer__tilt" type="button" aria-pressed="false">Tilt: off</button>
        <div class="steer__track"><span class="steer__knob"></span></div>
      </div>
    </div>`;
  padControls.insertBefore(root, padActions);

  const track = root.querySelector(".steer__track");
  const knob = root.querySelector(".steer__knob");
  const tilt = root.querySelector(".steer__tilt");
  const aux = root.querySelector("#analogAux");

  // Steering: drag anywhere on the track. One pointer owns steering at a time so
  // a second thumb on the pedals doesn't hijack it.
  track.addEventListener("pointerdown", (e) => {
    if (tiltOn) return; // gyro owns steering
    e.preventDefault();
    steerPointer = e.pointerId;
    try { track.setPointerCapture(e.pointerId); } catch { /* older browser */ }
    stickFromEvent(e);
  });
  track.addEventListener("pointermove", (e) => {
    if (steerPointer === e.pointerId) stickFromEvent(e);
  });
  const endSteer = (e) => {
    if (steerPointer !== e.pointerId) return;
    steerPointer = null;
    if (!tiltOn) { setKnob(0); markDrive(); } // self-center on release
  };
  track.addEventListener("pointerup", endSteer);
  track.addEventListener("pointercancel", endSteer);

  // Pedals: hold to engage. Capture the pointer so sliding off the button still
  // releases cleanly on lift.
  const pedals = [];
  for (const el of root.querySelectorAll(".pedal")) {
    const key = el.dataset.pedal;
    pedals.push({ el, key });
    el.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* older browser */ }
      drive[key] = true; el.classList.add("is-active"); markDrive();
    });
    const off = () => { if (drive[key]) { drive[key] = false; el.classList.remove("is-active"); markDrive(); } };
    el.addEventListener("pointerup", off);
    el.addEventListener("pointercancel", off);
  }

  tilt.addEventListener("click", () => toggleTilt(tilt));

  analog = { root, track, knob, tilt, pedals, aux };
}

// ---- Tilt (gyro) steering --------------------------------------------------
function onTilt(e) {
  if (e.gamma === null || e.gamma === undefined) return;
  if (tiltCenter === null) tiltCenter = e.gamma; // first reading = "straight"
  const SENS = 35; // degrees of tilt for full lock
  setKnob((e.gamma - tiltCenter) / SENS);
  markDrive();
}

async function toggleTilt(btn) {
  if (tiltOn) { disableTilt(); return; }
  // iOS 13+ gates motion sensors behind an explicit permission prompt.
  try {
    const DOE = window.DeviceOrientationEvent;
    if (DOE && typeof DOE.requestPermission === "function") {
      const res = await DOE.requestPermission();
      if (res !== "granted") { padLog.textContent = "Tilt needs motion access"; return; }
    }
  } catch { padLog.textContent = "Tilt unavailable"; return; }
  tiltCenter = null;
  tiltOn = true;
  steerPointer = null;
  window.addEventListener("deviceorientation", onTilt);
  btn.textContent = "Tilt: on";
  btn.setAttribute("aria-pressed", "true");
  if (analog) analog.root.classList.add("is-tilt");
}

function disableTilt() {
  if (!tiltOn) return;
  tiltOn = false;
  tiltCenter = null;
  window.removeEventListener("deviceorientation", onTilt);
  setKnob(0); markDrive();
  if (analog) {
    analog.root.classList.remove("is-tilt");
    analog.tilt.textContent = "Tilt: off";
    analog.tilt.setAttribute("aria-pressed", "false");
  }
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
