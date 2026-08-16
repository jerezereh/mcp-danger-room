# Danger Room

A digital client for Marvel: Crisis Protocol — roster building, local playtesting,
and online play in the browser.

> **Status: early scaffold.** The roster builder works against a 4-character
> corpus. The rules engine has a working skeleton — geometry, dice, movement
> validation, and the resolution loop — but most MCP rules are not implemented,
> and every rules constant needs verification against the rulebook. See
> [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

Node 20.11+. The repo currently builds on Node 18 but several dependencies warn,
and Vite 6+ will require 20. Use [nvm](https://github.com/nvm-sh/nvm) or similar.

## Getting started

```bash
npm install
npm test          # 37 tests across the rules and data packages
npm run typecheck # all five projects
npm run dev       # web client on http://localhost:5173
npm run dev:server # game server on :2567 (only needed for online play)
```

## Layout

```
packages/
  rules/     Headless, deterministic rules engine. Imports nothing.
  data/      Card schemas, the corpus, roster/squad rules.
  protocol/  Wire types shared by client and server. No logic.
apps/
  web/       React + react-three-fiber client.
  server/    Colyseus authoritative server.
assets/      Card images and the legacy JSON corpus.
```

The one architectural rule: **`packages/rules` imports nothing** — not React,
not three.js, not the network, not the filesystem. The same engine runs in the
browser for local play, on the server as the authority for online play, and in a
Web Worker as the simulator an AI opponent searches over. Everything else in the
repo is replaceable; that constraint is not.

## Card data

The corpus lives in `packages/data/src/characters.json`, validated by Zod at load
time. Four characters are imported from the old prototype and all are marked
`verified: false`.

To re-run the legacy import (overwrites the file):

```bash
node packages/data/scripts/import-legacy.mjs
```

Filling out the corpus is the largest single task in the project and is
independent of all engineering work.
