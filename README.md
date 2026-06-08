# game-controller

Phone/controller client for **Space Console** — turns a phone into a game
controller that joins a launcher (the TV) via a short room code, AirConsole-style.
Pairs with the `game-launcher-web` repo (the TV/screen side).

Zero-build, zero-backend static site — plain ES modules, no bundler, no
framework. Open `index.html` and it runs.

```sh
npm install     # dev server only
npm run dev      # http://localhost:5174 (auto-reload)
```

This is an early **placeholder**: a join screen + a stubbed control pad whose
transport (`assets/js/session.js connect()/send()`) is a seam to fill in with a
real WebSocket / WebRTC / AirConsole client.

## Documentation

All docs live in the **wiki** repo (the org-wide hub), not here:

- Service docs: `wiki/docs/services/game-controller/`
- How we build, deploy, and review across repos: `wiki/docs/way-of-working.md`

Published site: `main` deploys to the Pages root; feature branches get a preview
at `/preview/<branch-slug>-<hash>/`. Scripts are cache-busted at deploy time
(`npm run build` → `_dist/`); local `npm run dev` stays build-free.
