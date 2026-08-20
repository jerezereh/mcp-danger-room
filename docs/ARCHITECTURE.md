# Architecture

How Danger Room is put together, and why. Written to be argued with — the
decisions below are reversible in roughly the order they appear, and the first
few are the expensive ones.

---

## 1. The shape of the problem

MCP is not a card game with a board attached. Three properties drive everything:

**It is continuous, not gridded.** Range and movement are measured with physical
tools against model bases. There are no squares to snap to, so positions are
real-valued and "is this legal?" is a geometry question rather than a lookup.

**It is three-dimensional.** Terrain has height, models have size, elevation is a
real mechanic, and line of sight is traced through actual space. This is the rule
that most constrains the technical design.

**It is dense with interrupts.** Reactive superpowers fire mid-attack. Effects
modify rolls that have already been made. Resolution is not a function that runs
to completion — it is a process that stops, asks a player a question, and
resumes.

Each of those maps onto a decision below.

---

## 2. The core decision: a headless rules engine

`packages/rules` is a plain TypeScript package that **imports nothing**. No
React, no three.js, no network, no filesystem, no clock, no `Math.random`.

Its entire public surface is:

```ts
applyAction(state: GameState, action: Action): Result
```

Pure, deterministic, and total — it never throws for a game-rule reason, it
returns a typed rejection.

That constraint buys three things at once, which is why it is worth defending
even when it is inconvenient:

| Consumer | What it needs | Why the constraint delivers it |
|---|---|---|
| Browser (local play) | Run the full game with no server | No I/O to stub out |
| Server (online play) | Be the authority clients cannot forge | Same code, so no rules drift |
| Web Worker (AI) | Simulate thousands of positions fast | No rendering, no allocation of DOM |

The moment the engine reaches for the network or the DOM, all three break
together. If a future change seems to require it, that is the signal the change
belongs in a different package.

### What this replaces

The prototype found the character for a clicked table row by reading
`event.target.parentNode.childNodes[0].outerText` — the rules, such as they were,
lived in the DOM. Rosters were arrays of name strings, so per-model state
(damage, position, tokens) had nowhere to live and duplicate characters were
impossible to represent. The `CharacterId` / `ModelId` split in `ids.ts` exists
specifically to make that class of bug unrepresentable.

---

## 3. Three dimensions from day one

The client renders a top-down board. The engine stores `Vec3`.

This is deliberate and it is the decision most likely to look like overkill right
now. The reasoning: line of sight is genuinely a 3D problem, and it is not an
optional feature — it gates every attack in the game. A "2D version" that stores
`{x, y}` and adds elevation later means migrating every saved game, every test
fixture, and every position in every replay.

`geometry/geometry.test.ts` contains the case that justifies it:

```ts
it('clears a low wall when both models stand on rooftops', () => {
  const low = wall({ height: 2 });
  expect(hasLineOfSight(model(0, 0, 0), model(10, 0, 0), [low]).clear).toBe(false);
  expect(hasLineOfSight(model(0, 0, 8), model(10, 0, 8), [low]).clear).toBe(true);
});
```

Identical footprints, opposite answers, decided entirely by elevation.

### The camera is the "2D"

`apps/web/src/components/Board.tsx` renders a real 3D scene — models are
cylinders at real elevations, terrain has volume, the table is a plane in world
space. What makes it read as a flat board is one orthographic camera pointed
straight down. There is a toggle in the corner that swaps it for a perspective
camera; nothing else changes.

So "going 3D" later is a question of better meshes, better lighting, and better
art. It is not a rewrite — which is precisely what building a genuinely flat 2D
board would have cost.

One convention worth knowing: table coordinates are `x`/`y` with `z` as
elevation; three.js is `x`/`z` with `y` up. The swap is confined to `Board.tsx`
so the engine never has to think about rendering conventions.

---

## 4. Interrupts, and why continuations are data

This is the design decision that is easiest to get wrong and most expensive to
fix later.

MCP resolution has to pause. An attack is declared, dice are about to be rolled,
and the defender may have a reactive superpower that changes the roll. The engine
must stop, ask the defender, and resume mid-attack.

The obvious implementation is a closure — resolve up to the pause point, capture
the rest in a callback, invoke it when the answer arrives. **That would be a
mistake**, because a closure cannot be serialized. And the moment game state
stops being serializable, you lose:

- replays (a seed plus an action list no longer reconstructs the game)
- server authority (the server cannot hold a resumable position)
- reconnection (a dropped player cannot be handed the current state)
- spectating, save/resume, and AI search, for the same reason

So suspended resolution is represented as **data**: `state.stack` is an array of
`Frame` values describing what is mid-flight.

```ts
export type Frame =
  | { kind: 'activation'; modelId: ModelId; actionsRemaining: number }
  | { kind: 'attack'; step: AttackStep; attackerId: ModelId; /* … */ }
  | { kind: 'reactionWindow'; window: ReactionWindow; pendingPlayers: readonly PlayerId[] }
  | { kind: 'applyDamage'; modelId: ModelId; amount: number }
  | { kind: 'checkKO'; modelId: ModelId };
```

`resolve()` pops frames and advances them until the stack empties or a frame
needs input, at which point it parks a `Prompt` and returns. The next action
resumes from exactly that point. The whole game — including "we are three steps
into an attack, waiting on a reaction" — round-trips through `JSON.stringify`.

Damage carries its source for the same reason the sequence is stepped: Power is
gained only from *enemy* effects, so `applyDamage` has to know who caused it.
An unattributed frame would let a character pay for its next reaction by
hurting itself.

There is a test asserting exactly that, because it is the property everything
else rests on:

```ts
it('keeps state serializable as plain JSON', () => {
  const roundTripped = JSON.parse(JSON.stringify(result.state));
  expect(roundTripped).toEqual(result.state);
});
```

The attack sequence (`AttackStep`) is modelled as named steps rather than one
function precisely so that reaction windows have somewhere to insert
themselves. There are fourteen of them, one per printed step of the rulebook's
attack sequence, and three are interrupts.

The bet has now been tested. Black Panther's VIBRANIUM ARMOR — a real printed
superpower — interrupts a real attack at step 2, and the suspended position
looks like this:

```
activation | attack:payPower | reactionWindow
```

That whole thing round-trips through `JSON.stringify`, which is the property
the closure implementation would have cost. `apps/web/src/lib/reaction.test.ts`
asserts it against the corpus rather than against a fixture.

**Reaction eligibility cannot come from the corpus.** MCP superpowers are
prose — *"When this character is targeted by a {PHYS} or {ENRG} attack, it may
use this superpower"* — and there are 200 reactive ones, no two worded alike.
Nothing parses that reliably, and a parser that half-works is worse than none,
because a superpower firing at the wrong moment is a wrong game rather than a
missing feature. So structured triggers are hand-written in
`packages/data/src/reactions.ts` and passed in at setup exactly as stats are. A
superpower with no entry is carried on the profile and never offered, so the
gap reads as "not implemented" instead of as a character with no powers.

---

## 5. Determinism

The RNG lives inside `GameState` as a number. There is no module-level random,
no `Date.now()` inside the engine, no hidden state anywhere.

Consequences: the same seed plus the same actions always produces the same game.
A replay is a seed and a list of actions. The server can verify a client's claim
by re-running it. The AI can explore a branch and discard it without side
effects.

Two tests guard this, and they should be treated as load-bearing rather than
routine.

---

## 6. Package layout and the dependency rule

```
packages/rules     →  (nothing)
packages/data      →  zod, rules (types only)
packages/protocol  →  rules (types only)
apps/server        →  rules, protocol, colyseus
apps/web           →  rules, data, protocol, react, three
```

`data` depends on `rules` for types alone, and only because of
`data/src/reactions.ts` — the hand-written table of what each reactive
superpower actually does, which is card knowledge expressed in the engine's
vocabulary. It points at the innermost package, so the direction still holds
and the constraint that matters is untouched.

Dependencies point strictly inward. `rules` never imports `data` — the engine
operates on state, not on card definitions, and character stats are passed in
rather than looked up. That keeps the engine testable without a corpus and keeps
the corpus replaceable without touching the engine.

Stats reach the engine as a `CharacterProfile` **passed in at setup** rather
than looked up during resolution, so `applyAction` keeps its two-argument
signature and no consumer has to carry the corpus. The profile travels in the
`GameSpec`, which means it travels in the save — a corpus correction cannot
retroactively change a game that has already been played. `apps/web/src/lib/
profile.ts` is the only place the two shapes meet.

---

## 7. Online play

**Clients send intent; the server sends consequences.** A client never sends
state, because a client that can assert state is a client that can cheat.

```
client ──── SUBMIT_ACTION ────► server
                                  │ applyAction() — the only authority
       ◄──── EVENTS ──────────────┘
       ◄──── SNAPSHOT ──── (on join, resync, or desync)
```

Three details in `apps/server/src/GameRoom.ts` worth flagging:

**The server overwrites the actor.** A client's action carries a `player` field;
the server replaces it with the id bound to that connection before applying it.
Otherwise a forged field moves your opponent's models.

**Stale actions trigger a resync rather than an apply.** Actions carry the
sequence number the client believed it was acting on. A mismatch means the board
moved underneath them, so the server sends a snapshot instead of applying an
action whose preconditions may be gone.

**Seats survive disconnection.** Seat assignments are not deleted on leave, so a
dropped player reconnects into their own seat rather than losing the game to a
flaky connection.

State is stored as an opaque blob rather than mapped onto Colyseus schema
classes. Delta-syncing a deeply nested state buys little for a two-player
turn-based game and would force the state shape to be expressed twice.

### Why the web, briefly

Distribution is the whole ballgame for online play. Cockatrice's real friction is
that both players must install and version-match a desktop app. A URL has none of
that, and MCP's paragraph-dense card text is HTML's strongest suit and a game
engine's weakest. Tabletop Simulator already exists; competing on 3D fidelity is
a losing race, while "the rules are automated and I can play in a browser" is
open ground.

---

## 8. Client

React for UI chrome, react-three-fiber for the board, Zustand for what the engine
has no opinion about (selection, camera mode, connection status). Game state
belongs to the engine and is replaced wholesale by `applyAction` — mixing the two
is how client-side rules divergence starts.

**The client animates from events, not state diffs.** `GameLog.tsx` renders the
same `GameEvent` stream the server broadcasts and the board will eventually
animate from. This doubles as a design check: if a log line is hard to phrase,
the event is probably too coarse to animate either.

**Cards render from data, not images.** `CharacterCard.tsx` builds the stat block
from the corpus, and `CardText.tsx` turns `{P}`, `{D}`, `{R}` into glyphs.
Card images remain useful as a reference view, but a data-driven card is
searchable, themeable, readable at any size, and — critically — the same source
the engine acts on, so a discrepancy between what you read and what the rules do
becomes impossible rather than merely unlikely. Unknown glyphs render visibly
wrong on purpose.

---

## 9. What is actually built

**Real and tested:**

- Deterministic seeded RNG; dice with a data-driven face distribution and
  cascading criticals
- Base-to-base measurement, range bands, base contact
- Line of sight with terrain occlusion and elevation
- Movement validation — path length along a polyline, base overlap rejection,
  and the character's printed movement template
- The resolution loop, frame stack, and prompt parking
- The round loop as printed: a Power Phase granting 1 Power to every
  character, an Activation Phase of strictly alternating turns with passing,
  and a Cleanup Phase that flips Dazed characters, passes priority, and clears
  Activated tokens — in that order, because the order is load-bearing
- The action budget — a model gets `ACTIONS_PER_ACTIVATION` actions and its
  activation ends when they run out
- Attack dice, range, defense-by-damage-type, and stamina thresholds all read
  off the character's own card
- The rulebook's 14-step attack sequence, including the Power cost, the
  one-die floor on both pools, criticals resolving exactly once, the damage cap
  at remaining Stamina, and the refusal to target an ally
- Reaction windows at steps 2, 9, 11 and 14, with real eligibility — filtered
  by trigger, by side of the attack, by damage type, and by whether the
  character can pay
- Power spent on attacks and reactions, and gained both from the Power Phase
  and from suffering damage from an enemy effect — which closes the loop, since
  a character now earns the Power that pays for the superpower it needs
- Dazed as a state distinct from the Injured card face: a character out for the
  round that keeps its damage and its healthy stats until Cleanup flips it
- Roster/squad validation and legal-squad enumeration
- Card text tokenizer
- Legacy data importer (which found a real `{E}`/`{En}` inconsistency in the old
  corpus on its first run)
- Roster builder UI; board renderer with both cameras; event log

**Skeleton or absent:**

- Wild, critical and failure *triggers* — the `{WILD}` and `{FAIL}` clauses
  printed on attacks — are never read. `RollResult` counts all three and
  nothing consumes the counts.
- Step 9 does not distinguish modifying your own dice from forcing an opponent
  to modify theirs, because no effect can yet tell them apart.
- `ReactionEffect` has two variants, so nine superpowers out of 200 have a
  structured trigger. The rest are carried and never offered.
- Reactions triggered by an *allied character within Range n* being targeted —
  a large printed family — need a third model and a range band the structured
  trigger does not carry.
- Active superpowers, tactic cards, conditions, objectives, and VP are types
  without implementations. The game ends with no winner.
- The Power Phase grants its 1 Power and nothing else: the player and
  non-player effects that follow it are unimplemented, though 106 superpowers
  reference the phase. The 579 lines of attack text that grant Power are not
  read either.
- Passing is offered but never chosen for a reason — a player with characters
  left always activates unless a human declines. Grunts are not modelled, so
  the pass condition counts every character.
- Step 9 collapses two ordered sub-phases into one window (#12).
- The client cannot issue a move or an attack from the board; it can select a
  model and start its activation.
- Games start from a fixed sparring position rather than from drafted squads.
  The server's copy of that position still plays training dummies, because
  `apps/server` does not depend on `@danger-room/data`.
- Several rules constants are still unverified. See §11.
- No client/server wiring yet: the protocol and room exist, the client does not
  connect. Local play only.
- No AI, no lobby UI, no accounts.

---

## 10. Suggested order of work

*Tracked as GitHub issues #1–#10; #2, #3 and #4 are done.*

**1 — Roster builder against a real corpus.** No board, no server, no engine.
It is the feature the project was started for, it is useful the day the data
lands, and it forces the card schema into shape early, which is the schedule risk
that matters most.

**2 — Card data.** The long pole, and independent of all engineering. Worth
investigating whether a community dataset exists to import rather than
hand-typing ~200 characters. Everything downstream is gated on this.

**3 — Verify the rules constants.** Every value in `constants.ts` and the die
face distribution in `dice.ts` is a placeholder. They are isolated in two files
specifically so this is an afternoon rather than an excavation. Until this is
done the app reports confident wrong numbers.

**4 — Wire card data into the engine.** Replace the hardcoded stats. This is what
makes an attack mean something.

**5 — Complete one full attack.** All steps, one reactive superpower, one wild
trigger. This is the vertical slice that proves the frame architecture works
under real MCP wording. Expect to learn something that changes the design here —
better now than after twenty superpowers are written against it.

**6 — Client/server wiring.** The pieces exist; connect them and play a real game
over a URL.

**7 — Everything else.** Lobby UI, persistence, accounts, AI.

---

## 11. Risks and open questions

**Rules constants are partly invented.** Round count, actions per activation,
the Power Phase grant, the movement-template rule, and the die faces are now
verified against the rulebook. Range bands, movement distances, base radii and
size heights remain placeholders marked `TODO(verify)`. The geometry is
correct; several of the numbers it operates on are not.

The die is worth a note: it has **six** symbols, not five. Blank and Failure
both do nothing, but a Blank can be rerolled and a Failure cannot, and `{FAIL}`
is a symbol effects trigger on in its own right. The engine had one face doing
both jobs, which silently made every Failure rerollable and made 126 lines of
card text unrepresentable. Nothing the app reports
about probability or legality should be trusted until §10.3 is done.

**Line of sight is approximated.** `hasLineOfSight` samples the trace rather than
solving the volume, and does not implement MCP's terrain-size or cover rules. It
is isolated behind one function so a stricter version can replace it without
touching callers.

**The rules are the hard part, not the stack.** Timing windows, reactions, and
interrupts are where automated implementations of miniatures games die. The frame
architecture is a bet that this is manageable. Milestone §10.5 is the test of that
bet and should be run early.

**Card data is a months-long task** and is what actually gates a usable product.

**The IP question needs a decision.** Shipping AMG/Marvel card text and 144
scraped images from your own server is the shape of thing that draws a takedown.
Cockatrice's survival strategy is deliberate: ship the engine, ship no card data,
let users import it. Worth settling before a distribution model is built on the
opposite assumption.

**Node 18 is past EOL.** The repo builds on it today with warnings; Vite 6+ will
require 20+. Upgrade before it becomes urgent.

**Bundle size.** The client is already ~1MB (294KB gzipped) before a single card
image, mostly three.js. Code-split the board away from the roster builder — the
roster route does not need a 3D engine.

---

## 12. Decisions deliberately deferred

- **Persistence.** localStorage is genuinely fine until rosters need to follow
  people across devices.
- **Accounts.** Not needed for "send a friend a URL."
- **Desktop builds.** Tauri wraps the same web app in ~5MB whenever it is wanted.
  Nothing in the design forecloses it.
- **AI opponent.** The headless engine makes it possible; nothing else about it
  needs deciding yet.
