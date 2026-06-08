// Controller session — the transport seam, mirror image of the launcher's
// PlayerSession. The launcher's TV is the "screen"; this phone is a
// "controller" that joins a room by code and *sends* intents to it.
//
// The transport is intentionally a stub today (so the controller runs with no
// backend). Drop a WebSocket / WebRTC / AirConsole client into connect()/send()
// later without touching the UI.

export class ControllerSession extends EventTarget {
  constructor() {
    super();
    this.roomCode = null;
    this.connected = false;
  }

  /** Join a room by code. Replace the body with a real transport handshake. */
  connect(roomCode) {
    this.roomCode = (roomCode || "").toUpperCase();
    // TODO: open transport, register against roomCode, resolve when the screen
    // acknowledges this controller. For now we optimistically "connect".
    this.connected = true;
    this.dispatchEvent(
      new CustomEvent("ready", { detail: { roomCode: this.roomCode } })
    );
    return this;
  }

  /** Send a normalized intent (up/down/left/right/enter/back) to the screen. */
  send(intent) {
    if (!this.connected) return;
    // TODO: serialize and push over the transport.
    this.dispatchEvent(new CustomEvent("sent", { detail: { intent } }));
  }

  disconnect() {
    this.connected = false;
    this.roomCode = null;
    this.dispatchEvent(new CustomEvent("closed"));
  }
}
