// Controller session — the WebRTC *offerer*. The launcher's TV is the "screen";
// this phone is a "controller" that joins a room by code and *sends* intents.
//
// It connects to the signaling service only to do the WebRTC handshake, then
// opens a DataChannel straight to the TV and sends intents over it peer-to-peer.
// The signaling socket goes idle once the channel is open. The UI is untouched:
// the same `ready` / `sent` / `closed` events (plus `error`) drive it.

// RTCPeerConnection config. Public STUN is enough while the phone and the TV sit
// on one network; a TURN relay is what makes everything else work (phone on mobile
// data, TV on Wi-Fi, iOS's mDNS-masked candidates). TURN credentials come from the
// server at `/api/ice` — they can't be committed, since this repo is public.
//
// Fetched once at load into a module-level cache, so `connect()` only has to await
// a promise that has almost certainly already settled by the time a player taps Join.
//
// Query params still win, for pointing a single device at a TURN the server doesn't
// know about (mirrors ?signal=):
//   ?turn=turn:<host>:3478&turnuser=<u>&turncred=<p>   add a TURN server
//   ?relay=1                                           force relay-only (to verify TURN)
const DEFAULT_ICE = [{ urls: "stun:stun.l.google.com:19302" }];
let vendedIce = null;

// Best-effort: if there's no /api/ice (e.g. the app is on a static host), we simply
// fall back to STUN, which still covers same-network play.
const iceReady = fetch("/api/ice")
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    if (d && Array.isArray(d.iceServers) && d.iceServers.length) vendedIce = d.iceServers;
  })
  .catch(() => { /* no server-vended ICE — STUN only */ });

function rtcConfig() {
  const q = new URLSearchParams(location.search);
  const iceServers = (vendedIce || DEFAULT_ICE).slice();
  const turn = q.get("turn");
  if (turn) {
    // Comma-separated list → one server with multiple URLs (ICE tries each).
    const urls = turn.split(",").map((s) => s.trim()).filter(Boolean);
    iceServers.push({ urls, username: q.get("turnuser") || "", credential: q.get("turncred") || "" });
  }
  const config = { iceServers };
  if (q.get("relay") === "1") config.iceTransportPolicy = "relay";
  return config;
}

export class ControllerSession extends EventTarget {
  constructor() {
    super();
    this.roomCode = null;
    this.connected = false;
    this._ws = null;
    this._pc = null;
    this._dc = null;
    this._pendingIce = [];
    this._intentional = false; // true only for a user-initiated Leave
    this._attempt = 0;         // connect() generation, so a stale attempt can't open
  }

  /** Join a room by code: signal in, then open a peer DataChannel to the TV. */
  connect(roomCode, name) {
    this._closeConnections(); // drop any half-dead sockets before reconnecting
    this.roomCode = (roomCode || "").toUpperCase();
    this.name = (name || "").trim() || null; // shown on the TV roster / leaderboards

    // An RTCPeerConnection's ICE servers are fixed at construction, so we have to
    // know the TURN config before building it. The fetch starts at page load, so by
    // the time someone taps Join this is already settled. Stays synchronous for
    // callers (app.js just calls connect() and listens for events).
    const attempt = this._attempt; // bumped by _closeConnections on leave/rejoin
    iceReady.then(() => {
      if (this._attempt !== attempt) return; // superseded by a Leave or a re-Join
      this._open();
    });
    return this;
  }

  _open() {
    const pc = new RTCPeerConnection(rtcConfig());
    this._pc = pc;
    const dc = pc.createDataChannel("intents", { ordered: true });
    this._dc = dc;

    dc.addEventListener("open", () => {
      this.connected = true;
      this.dispatchEvent(new CustomEvent("ready", { detail: { roomCode: this.roomCode } }));
    });
    // The TV sends JSON control layouts (which buttons to show) down this channel.
    dc.addEventListener("message", (m) => {
      let msg;
      try { msg = JSON.parse(m.data); } catch { return; }
      if (msg && msg.type === "controls") {
        this.dispatchEvent(new CustomEvent("controls", { detail: msg }));
      }
    });
    dc.addEventListener("close", () => this._teardown());

    pc.addEventListener("icecandidate", (e) => {
      if (e.candidate) this._signal({ ice: e.candidate });
    });
    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") this._teardown();
    });

    const ws = new WebSocket(signalingUrl());
    this._ws = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "join", code: this.roomCode, name: this.name }));
    });
    ws.addEventListener("message", async (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.type === "joined") {
        // Room exists — make the offer.
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this._signal({ sdp: pc.localDescription });
      } else if (msg.type === "signal") {
        if (msg.data.sdp) {
          await pc.setRemoteDescription(msg.data.sdp);
          for (const c of this._pendingIce) await pc.addIceCandidate(c);
          this._pendingIce = [];
        } else if (msg.data.ice) {
          if (pc.remoteDescription) await pc.addIceCandidate(msg.data.ice);
          else this._pendingIce.push(msg.data.ice); // buffer until remote SDP is set
        }
      } else if (msg.type === "error" || msg.type === "host-gone") {
        this.dispatchEvent(new CustomEvent("error", { detail: { reason: msg.reason || msg.type } }));
        this._teardown();
      }
    });
    ws.addEventListener("error", () => {
      this.dispatchEvent(new CustomEvent("error", { detail: { reason: "signal-unreachable" } }));
    });

    return this;
  }

  _signal(data) {
    if (this._ws && this._ws.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify({ type: "signal", data }));
    }
  }

  /** Send a normalized intent (up/down/left/right/enter/back) to the screen. */
  send(intent) {
    if (this.connected && this._dc && this._dc.readyState === "open") this._dc.send(intent);
    this.dispatchEvent(new CustomEvent("sent", { detail: { intent } }));
  }

  /**
   * Send a continuous analog driving frame to the screen (steering games). Shares
   * the intents channel using a compact JSON envelope `{t:"a",s,g,b,h}` the TV
   * distinguishes from plain intent strings. Values are rounded to 2 decimals to
   * keep frames small since these fire many times a second while steering.
   *   steer/throttle: -1..1   brake: 0..1   handbrake: bool
   */
  sendAnalog(steer, throttle, brake, handbrake) {
    if (!(this.connected && this._dc && this._dc.readyState === "open")) return;
    const r = (v) => Math.round((Number(v) || 0) * 100) / 100;
    this._dc.send(JSON.stringify({
      t: "a", s: r(steer), g: r(throttle), b: r(brake), h: handbrake ? 1 : 0,
    }));
  }

  disconnect() {
    this._intentional = true; // an explicit Leave — forget the room, don't rejoin
    this._teardown();
  }

  // Close the live sockets/peer without announcing it — used both by teardown and
  // when reconnecting (so a stale connection can't leak or double-fire events).
  _closeConnections() {
    // Invalidate any connect() still waiting on the ICE fetch, so a Leave (or a
    // second Join) can't be followed by a stale peer opening behind it.
    this._attempt = (this._attempt || 0) + 1;
    this.connected = false;
    if (this._dc) {
      try { this._dc.close(); } catch { /* already closing */ }
      this._dc = null;
    }
    if (this._pc) {
      try { this._pc.close(); } catch { /* already closing */ }
      this._pc = null;
    }
    if (this._ws) {
      try { this._ws.close(); } catch { /* already closing */ }
      this._ws = null;
    }
    this._pendingIce = [];
  }

  _teardown() {
    this._closeConnections();
    const intentional = this._intentional === true;
    this._intentional = false;
    // Keep roomCode/name after an unintentional drop (tab backgrounded, network
    // blip) so the UI can rejoin the SAME room; only an explicit Leave clears it.
    if (intentional) this.roomCode = null;
    this.dispatchEvent(new CustomEvent("closed", { detail: { intentional } }));
  }
}

// Where the signaling service lives. Defaults to the page's OWN origin
// (host:port), so app + signaling served from one server just works and phones
// can reach it (iOS only lets page JS reach the origin host:port). Override with
// ?signal=ws://<host>:<port> when signaling runs on a different host/port.
function signalingUrl() {
  const override = new URLSearchParams(location.search).get("signal");
  if (override) return override;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host || "localhost:8080"}`;
}
