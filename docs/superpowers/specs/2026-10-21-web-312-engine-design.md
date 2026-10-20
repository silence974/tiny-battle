# Web 312 engine and five-party realtime game

## Goal

Deliver the first playable Web version of the 312 cooperative board game from
the tiny-battle project root. The deployed client is a static GitHub Pages
site. One host browser is the only rules referee and four player browsers join
the same live room through Supabase Realtime.

The formal runtime is JavaScript in the Web app. The existing Python
simulation is a reference for rule values and validation only; it is not
loaded or required by the product.

## Scope

In scope for this version:

- A deterministic, configuration-driven 312 rules engine in the repository
  root, independent of the DOM and Supabase.
- The complete playable loop: exploration, production, purchase, three-AP
  action phase, simultaneous combat/displacement, two black actions, and
  cooperative outcome.
- Four player seats plus one non-player host seat.
- Supabase anonymous authentication and a private Realtime room channel.
- Host-created room, seat allocation, player join/leave, ordered commands,
  authoritative snapshots, reconnect snapshot delivery, and visible errors.
- A minimal browser shell for creating/joining a room and displaying the
  current state and legal actions. Layout and visual polish are deferred to
  the UI discussion tomorrow.
- A host-only four-perspective debug page opened from a small button in the
  game home page. It can inspect and operate all four seats for fast playtest
  and debugging; ordinary seat links cannot open it or view other seats.
- Four seat links that work for both human browsers and local agents. Agents
  use a structured JSON client instead of scraping or receiving verbose UI
  text, so a turn can be completed with a compact snapshot/legal-action
  request followed by one action request.
- A small local Agent client/example that joins the same Supabase room
  protocol from Node and exposes `snapshot`, `legalActions`, and `act` calls.
- Node tests for engine invariants, legal actions, phase transitions,
  simultaneous combat, cooperative outcome, room protocol, and static browser
  smoke checks.

Out of scope for this version:

- Supabase Edge Functions or a server-side rules engine.
- Persistent Postgres game state, host migration, or resuming after the host
  refreshes or leaves.
- Anti-cheat guarantees: the host is trusted as the referee.
- TURN/relay deployment and production-grade matchmaking.
- Final visual design, animation, accessibility polish, or mobile layout.
- Changes to the existing `p2p-vote` prototype.

## Rule authority and engine boundary

`engine312.js` is a pure module. It owns all mutable game state and accepts
only validated commands. `app.js` and `supabase-room.js` may render, transport,
or queue commands, but may not alter state directly.

The public engine surface is:

```js
createGame({ seed, players, config })
snapshot(state, viewerId)
legalActions(state, playerId)
applyCommand(state, command) // returns { state, events }
advance(state)                // resolves queued phase work
outcome(state)
```

All random choices use the seeded PRNG stored in the state. Every accepted
command increments `state.seq`; the command, resulting events, and public
snapshot are deterministic for a given seed and command sequence. A command
contains `{ seq, playerId, action }` and is accepted only in the matching
phase, for the matching active seat, and with sufficient resources/AP.

Snapshots are viewer-aware: public board/player information is shared, while
hand contents and private expedition/event choices are shown only to the
owning player. The host receives the full referee state but broadcasts only
the appropriate per-viewer snapshot.

## 312 state and phase model

The initial configuration is the candidate 312 values already used by the
simulator: a 7x7 board, four player HQs at the corners, black HQ at the
center, starting resources/forces, capacity-based production, the five
building types, black deck and expansion steps, and the 1 face-up plus 1 blind
purchase limits. Values live in a checked-in Web JSON module so tests can use
small deterministic fixtures without changing the rule code.

Each round progresses in this order:

1. `exploration`: players act in seat order; an expedition to unknown terrain
   resolves immediately.
2. `production`: all buildings and HQ production resolve together.
3. `purchase`: each seat may buy at most one face-up and one blind card; this
   phase costs no AP and refills the face-up market immediately.
4. `action`: players act in round-robin seat order. Each pass through P1→P4
   gives each non-passed seat one action, and rounds repeat until every seat
   has spent all three AP or passed. A seat never spends all three AP before
   the other seats get their turn. Purchase is not legal here, but cards
   bought earlier in the same round may be built during this phase.
5. `combat`: all attacks created during the action phase resolve together;
   ties, empty defenders, and displacement follow the 312 rules.
6. `black`: two black cards resolve. The final battle ends the game if the
   black HQ remains.

The engine explicitly represents expeditions, same-cell multiple expeditions,
unknown/neutral/black control, one-time black-zone rewards, permanent points,
HQ protection, route food fees, buildings, reserve forces, and action logs so
that the browser can explain each result. The cooperative outcome is shared:
capturing the black HQ makes the player side completely win; a black action
card that forces the final battle while the black HQ remains standing makes
the player side lose. In either outcome, the engine computes individual
scores and a final ranking. Ranking is reported after the win/loss result and
does not override it. Ranking compares total score first, then remaining
gold, then the count of controlled non-HQ tiles; all three equal means a tie.

The 312 boundary values are explicit: if black expansion covers an unknown
tile with no expedition, the original unrevealed exploration event is not
retained; if a successful black-zone attack is followed by failure of the
original exploration event, the tile becomes neutral. Building is allowed on
an explored empty tile without current control or a route, but its production,
control, and score apply only while the player has a stationed unit and thus
controls the tile.

## Five-party realtime architecture

The host creates a high-entropy room code and joins a private Supabase
Realtime topic such as `game312:<room>`. The host is not one of the four
player seats. Players authenticate anonymously, submit a join request, and
receive a deterministic seat assignment from the host.

The host also generates four seat links containing a room locator, a fixed
seat number, and a short-lived seat token in a compact URL fragment. The same
room/seat always produces the same reusable short link from both the home page
and debug page. A human opens the link in `index.html`; a local Agent uses the
same link metadata with the Node client. The Agent client never
needs to parse HTML or consume the full event log: it requests a compact
viewer-scoped snapshot, receives the already-computed legal action list, and
sends one structured action. The host validates the token, seat, sequence,
reconnect identity, and action exactly as it does for a browser player. The
fragment keeps the seat token out of GitHub Pages requests and ordinary URL
logs.

The debug page is authorized only for the online host identity. It renders
four separate viewer snapshots and can submit commands for any seat. A
normal player or Agent link receives only its bound seat's private state and
action permission. If a human and Agent use the same seat at once, the host
accepts at most one command for the current sequence and sends an explicit
sequence-conflict rejection for the other request.

Dispatch actions preserve the player's explicit route contract rather than
recomputing a shortest path. The action payload includes the origin, target,
the ordered cardinal route, and the number/type of forces taken at each route
step. The engine validates that every intermediate tile is a connected
controlled tile where required, charges food from the route length, and keeps
different legal routes and force allocations distinguishable in the event
log.

The room protocol uses Broadcast messages with explicit envelopes:

- `hello`: client identity, requested nickname, protocol version.
- `roster`: host-authoritative host identity, four seats, and room status.
- `command`: player command with client request id and expected sequence.
- `state`: host sequence, event summary, and viewer-specific snapshot.
- `reject`: request id plus a human-readable invalid-command reason.
- `resync`: client asks for the latest snapshot after reconnect or a gap.
- `leave`: client departure and seat release.

Only the host accepts commands into `engine312.js`. Supabase transports the
messages; it is not treated as the rules authority. A player applies a
received `state` only when its sequence is newer than the local sequence.
Duplicate request ids, duplicate state messages, wrong-room messages, and
stale sequence values are ignored safely. On a reconnect, the player requests
`resync` and the host sends the current snapshot; the host remains the source
of truth and must remain online for play to continue.

The browser ships only the Supabase project URL and publishable/anon key. The
client uses anonymous Auth and a private Realtime channel. No service-role
credential is bundled. Room codes identify rooms but are not authorization;
the host checks the four-seat roster and rejects a fifth player.

## Root-level file layout

- `index.html`: minimal host/player entry point for GitHub Pages.
- `app.js`: DOM wiring, host/player mode, command submission, and rendering.
- `engine312.js`: pure Web rules engine and public API above.
- `config-312.js`: checked-in public candidate-312 values and fixture helpers.
- `supabase-config.example.js`: public URL/key configuration template.
- `supabase-room.js`: Auth, private Realtime channel, room protocol, and
  reconnect lifecycle.
- `agent-client.js`: Node/browser-neutral structured room client for local
  agents; exports `join`, `snapshot`, `legalActions`, `act`, and `leave`.
- `agent-example.js`: minimal local command example that prints compact JSON
  and sends a selected action without requiring a UI.
- `package.json`: Node dependency declaration for `@supabase/supabase-js` and
  the local Agent command entry.
- `styles.css`: deliberately minimal layout for the functional MVP.
- `debug.html` and `debug.js`: host-only four-seat perspective page and
  compact reusable seat-link controls.
- `tests/engine312.test.js`: deterministic rule and conservation tests.
- `tests/supabase-room.test.js`: pure protocol/seat/sequence tests.
- `tests/ui.test.js`: static entrypoint and script-order smoke tests.
- `README.md`: local run, Supabase setup, GitHub Pages deployment, host/player
  flow, and known limitations.

The existing `p2p-vote/` tree remains unchanged.

## Acceptance criteria

- A fresh static serve of the repository root loads without a build step.
- One host can create a room and four different browsers can join as seats
  1–4; a fifth join is rejected.
- All four players see phase, resources, legal actions, board changes, and
  shared outcome updates in realtime through Supabase.
- Each of the four seat links can be used by either a human browser or a local
  Agent; an Agent can join, request compact legal state, submit an action, and
  receive the next state without UI scraping.
- The home-page link button and host debug page produce the same compact,
  reusable link for each room/seat, and the debug page cannot be opened by a
  normal seat client.
- The host alone can advance the authoritative state; invalid, stale, or
  out-of-turn commands are rejected without mutating the game.
- The engine passes deterministic tests for the 312 phase order, seven-step
  expansion/HQ protection, simultaneous combat/ties/empty defenders, one-time
  black rewards and HQ scoring, route food fees, exploration versus combat
  displacement, multiple expeditions, and resource/AP/control/score
  conservation.
- Capturing the black HQ reports a shared win for all four players; allowing
  the final black action-card termination reports a shared loss; both outcomes
  include a recomputed individual score ranking.
- Missing Supabase configuration and auth/channel errors are shown as
  actionable messages rather than silent failures.
- Node tests, syntax checks, and a static browser smoke test pass. No secret or
  service-role key appears in the repository.

