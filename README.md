# Danger Room

A digital client for Marvel: Crisis Protocol — roster building, local playtesting,
and online play in the browser.

> **Status: playable, unfinished.** Two people can sit at one keyboard and play
> a game: activate, move, attack, react, and reach the end of six rounds
> against real card data. Nobody wins yet — objectives and Victory Points are
> not implemented — and most superpowers and conditions are still outstanding.
> The distances it measures with are the real ones. See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

Node 20.11+. The repo currently builds on Node 18 but several dependencies warn,
and Vite 6+ will require 20. Use [nvm](https://github.com/nvm-sh/nvm) or similar.

## Getting started

```bash
npm install
npm test          # 397 tests across the rules, data, and web packages
npm run typecheck # all five projects
npm run dev       # web client on http://localhost:5173
npm run dev:server # game server on :2567 (only needed for online play)
npm run play:demo  # play a game in the terminal and read the transcript
```

`play:demo` runs a full six-round game against real card data and narrates it
from the engine's event stream — dice pools, reaction windows, Power, Dazed and
the flip. It takes a seed, so a run is reproducible and quotable in a bug
report:

```bash
npm run play:demo -- --seed=42
npm run play:demo -- --seed=42 --pass-reactions
```

Card scans are optional and fetched separately — about 450 images, ~410MB, so
they are gitignored rather than committed:

```bash
npm run fetch:images --workspace @danger-room/data
```

Without them the app works normally and each character card says how to get
them. They are served from `assets/card-scans/` by the dev server, deliberately
outside `apps/web/public` so they are not copied into the production build.

## Layout

```
packages/
  rules/     Headless, deterministic rules engine. Imports nothing.
  data/      Card schemas, the corpus, roster/squad rules.
  protocol/  Wire types shared by client and server. No logic.
apps/
  web/       React + react-three-fiber client.
  server/    Colyseus authoritative server.
assets/      Card scans, fetched on demand and gitignored.
```

The one architectural rule: **`packages/rules` imports nothing** — not React,
not three.js, not the network, not the filesystem. The same engine runs in the
browser for local play, on the server as the authority for online play, and in a
Web Worker as the simulator an AI opponent searches over. Everything else in the
repo is replaceable; that constraint is not.

## Card data

The corpus lives in `packages/data/src/characters.json`, validated by Zod at load
time. 233 characters, built from three community sources plus a vision-model
reader for the cards none of them cover:

```bash
npm run import:cards   --workspace @danger-room/data   # rebuild the corpus
npm run report:defects --workspace @danger-room/data   # what still needs a human
npm run extract:cards  --workspace @danger-room/data   # read cards with Claude (costs money)
```

`overrides.json` holds human corrections and is the only path to
`verified: true`; it is applied after the merge and beats every source.
