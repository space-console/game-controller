# game-controller

The **phone/controller** app for **Space Console** — turns a phone into a game
controller that joins the launcher (the TV) by a short **room code** or a scanned
QR, AirConsole-style. Pairs with the `game-launcher-web` repo (the TV/screen side).

It opens a **WebRTC DataChannel straight to the TV** and sends input peer-to-peer;
the `web-api` service only brokers the handshake (room code + SDP/ICE) and vends
STUN/TURN. The controller renders whatever pad the running game asks for over that
channel:

- a **d-pad** + action buttons for menus and classic games;
- a **landscape analog driving pad** (steering joystick + gas / brake / drift,
  with optional tilt steering) for racing games, streamed as continuous frames;
- **name entry** on join (shown in the TV's player roster), and **auto-rejoin**
  if the tab is backgrounded or the network blips.

Zero-build, zero-backend static site — plain ES modules, no bundler, no
framework. Open `index.html` and it runs.

```sh
npm install     # dev tooling only
npm run dev     # http://localhost:5174 (auto-reload)
```

## Transport

The client lives in `assets/js/session.js`:

- `send(intent)` — a discrete button press (`up/down/left/right/enter/back`, plus
  game-declared aux buttons like `reset` / `powerup`).
- `sendAnalog(steer, throttle, brake, handbrake)` — a continuous driving frame.

Both go over the DataChannel; the TV relays them into the running game. Signaling
defaults to the page's own origin, and ICE/TURN is fetched from the server at
`/api/ice` (a `?signal=` / `?turn=` query param can override per device). For real
phones, the controller, the launcher and the signaling socket must share **one
origin** — the `web-api` repo serves them together (see its README).

## Documentation

All docs live in the **wiki** repo (the org-wide hub), not here:

- Service docs: `wiki/docs/services/game-controller/`
- How we build, deploy, and review across repos: `wiki/docs/way-of-working.md`

Published site: `main` deploys to the Pages root; feature branches get a preview
at `/preview/<branch-slug>-<hash>/`. Scripts are cache-busted at deploy time
(`npm run build` → `_dist/`); local `npm run dev` stays build-free.
