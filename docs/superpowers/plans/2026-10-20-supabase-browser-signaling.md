# Supabase browser signaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace manual invite/answer URL exchange in `p2p-vote` with Supabase Realtime signaling while keeping the four-player vote rules and WebRTC data path in browsers.

**Architecture:** A small pure signaling module owns room/seat allocation and signal envelopes. `app.js` uses the Supabase browser client to join one private room topic, receives a player join, creates the existing host-player WebRTC offer, and sends the answer back through Broadcast. Once host-player DataChannels are open, the existing mesh and vote protocol remain unchanged. A public-safe runtime config file supplies only the Supabase URL and publishable key.

**Tech Stack:** Static HTML/CSS/JavaScript, browser WebRTC, `@supabase/supabase-js` v2 from CDN, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-10-20-supabase-browser-signaling-design.md`

## Global Constraints

- The host is a coordinator and is not one of the four player seats.
- Supabase is used for room/signaling transport, not game rules or game-state persistence.
- No secret or `service_role` key may be shipped to the browser.
- The MVP does not add Postgres room persistence, host migration, TURN, or server-authoritative rules.
- Existing player-to-player WebRTC DataChannels and vote semantics remain compatible.

## Review Focus

- Empty or placeholder Supabase config must produce an actionable setup error without opening a network connection — covered by Task 1 config tests.
- Duplicate, stale, or incorrectly targeted signal envelopes must be ignored without changing room state — covered by Task 1 envelope tests.
- A fifth player or an unknown room must be rejected without creating an RTCPeerConnection — covered by Task 1 seat/state tests and Task 2 browser smoke assertions.
- Supabase auth/channel failure must leave the UI recoverable and clean up the channel — covered by Task 2 integration seams and static smoke.
- Refresh/host departure must not claim persistence or silently resume — covered by Task 3 README and Task 4 manual acceptance checklist.

### Task 1: Add pure signaling protocol and room state

**Files:**
- Create: `p2p-vote/signaling.js`
- Create: `p2p-vote/signaling.test.js`

**Interfaces:**
- `validateConfig(config) -> { ok: boolean, message?: string }`
- `roomTopic(room) -> string`
- `createRoomState(room, hostId) -> { room, hostId, players, nextSeat }`
- `allocateSeat(state, player) -> { accepted: boolean, seat?: number, reason?: string }`
- `releaseSeat(state, playerId) -> boolean`
- `makeSignal({ room, from, to, id, type, payload }) -> object`
- `acceptSignal(seenIds, signal, context) -> { accepted: boolean, reason?: string }`

- [ ] **Step 1: Write failing Node tests** for valid/invalid config, exact topic construction, deterministic seats 1–4, full-room rejection, release/reuse, envelope shape, duplicate IDs, wrong room, and wrong target.
- [ ] **Step 2: Run `node --test p2p-vote/signaling.test.js`** and verify the new module/tests fail because the interfaces do not exist.
- [ ] **Step 3: Implement the pure module** with no DOM, Supabase, or WebRTC dependency; export through `module.exports` for Node and `window.Signaling` for the browser.
- [ ] **Step 4: Run the focused tests** and verify all protocol/state cases pass.
- [ ] **Step 5: Commit** `test: define Supabase signaling protocol`.

### Task 2: Replace manual URL flow with Supabase Realtime in the app

**Files:**
- Create: `p2p-vote/supabase-config.example.js`
- Modify: `p2p-vote/index.html`
- Modify: `p2p-vote/app.js`
- Modify: `p2p-vote/style.css`
- Modify: `p2p-vote/ui.test.js`

**Interfaces:**
- Browser global `window.SUPABASE_CONFIG = { url, publishableKey }`.
- Browser global Supabase client from `window.supabase.createClient`.
- `startSignaling()` and `stopSignaling()` lifecycle functions internal to `app.js`.
- Broadcast event `signal` with payload `{ room, from, to, id, type, payload }`.

- [ ] **Step 1: Add failing UI/static tests** asserting config script and Supabase CDN load before `app.js`, a room-code input/start/join control, and absence of the manual invite/answer controls.
- [ ] **Step 2: Run `node --test p2p-vote/ui.test.js`** and verify the new assertions fail against the current HTML.
- [ ] **Step 3: Add the public-safe config example and HTML controls**; keep the checked-in example empty so a missing configuration is explicit.
- [ ] **Step 4: Implement `startSignaling()`**: validate config, create the Supabase client, call anonymous sign-in, join `room:<room>`, use `config.private: true`, and subscribe to the `signal` Broadcast event. Render actionable errors for missing config, disabled Anonymous Auth, full room, and channel failure.
- [ ] **Step 5: Implement host/player signaling flow**: host creates a room and waits for `join`; player sends `join`; host allocates a seat and creates the existing host WebRTC offer; player creates an answer; both route descriptions through the signal envelope and reject duplicate/stale/incorrect signals. Preserve `attachChannel`, roster, mesh negotiation, voting, and host non-player behavior.
- [ ] **Step 6: Implement cleanup** on `beforeunload`, explicit leave, channel close, and rejected joins; remove the Supabase channel and close only the relevant peer connection.
- [ ] **Step 7: Run Node tests, `node --check p2p-vote/app.js`, and a static HTML smoke script**; verify the new controls and script order are present and no manual URL path remains reachable.
- [ ] **Step 8: Commit** `feat: use Supabase for browser signaling`.

### Task 3: Document Supabase and GitHub Pages configuration

**Files:**
- Modify: `p2p-vote/README.md`

**Interfaces:** Documentation only; commands and settings must match the files from Tasks 1–2.

- [ ] **Step 1: Add the exact setup checklist**: create a Supabase project, enable Anonymous Auth, configure private Realtime authorization/RLS for `realtime.messages`, copy the example config to the deployed config file, and enable GitHub Pages for the repository path.
- [ ] **Step 2: Document security boundaries**: publishable key is browser-visible; secret/service-role key is never used; room codes are locators, not authorization; no persistence, host migration, or TURN in this MVP.
- [ ] **Step 3: Document the player flow and troubleshooting** for missing config, `RealtimeDisabledForTenant`, private-channel RLS failure, unknown/full rooms, and P2P failure requiring TURN.
- [ ] **Step 4: Run a link/path grep smoke check** against the README and commit `docs: explain Supabase and GitHub Pages setup`.

### Task 4: Full verification and handoff

**Files:** No new product files; verification uses the repository.

- [ ] **Step 1: Run `node --test p2p-vote/*.test.js`** and require all tests to pass.
- [ ] **Step 2: Run `node --check p2p-vote/game.js`, `node --check p2p-vote/app.js`, and a fresh static HTTP smoke check** for `index.html`, `game.js`, `signaling.js`, and the config/CDN script order.
- [ ] **Step 3: Clone the pushed `main` into a fresh temporary directory and rerun the Node tests and syntax checks** to prove the deployed tree contains the change.
- [ ] **Step 4: Review `git diff`, verify no secret-shaped value is present, and commit/push any final fixes.
- [ ] **Step 5: Report the commit, tests, exact Supabase settings the owner must configure, and the remaining TURN limitation.**
