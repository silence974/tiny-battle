# SDD ledger — plan: docs/superpowers/plans/2026-10-21-web-312-engine.md

Pre-flight: Task 1 produces `engine312.js`/`config-312.js` consumed by Task 2 host flow; Task 2 produces room and Agent APIs consumed by Task 3. The interfaces are recorded in the plan and all downstream work waits for the earlier task's tests.

Ruling: The browser engine is implemented in CommonJS-compatible JavaScript with a browser global fallback because the repository has no build step and Node's built-in test runner is the available verification path.

Task 1: complete — `node --test tests/engine312.test.js` (12 passed, 0 failed), `node --check engine312.js`, `node --check config-312.js`, and `git diff --check` passed. Commit: `4e073a2`.

Task 2: complete — `node --test tests/supabase-room.test.js tests/agent-client.test.js` (10 passed, 0 failed), syntax checks for `supabase-room.js`, `agent-client.js`, and `agent-example.js`, plus `npm run agent:step -- --help` passed. Commit: `5d943e7`. Real Supabase connectivity remains an external acceptance check for Task 4.

Task 3: complete — `node --test tests/ui.test.js` (4 passed, 0 failed), syntax checks for `app.js`, `debug.js`, `agent-example.js`, and `supabase-room.js`, plus static HTTP fetches for all root pages/scripts passed. Full suite at this point: 51 passed, 0 failed. Commit: `a4fb677`.

Task 4: implementation re-opened after review. Review found missing playable rules and a seat/client identity mismatch. Fixed in `4327d30`; follow-up `d51c278` fixes own-tile dispatch merging, one-final-card-per-black-phase timing with discard refill, and black HQ permanent points. Fresh verification: `npm test` 61 passed/0 failed; all root syntax checks, `git diff --check`, precise secret-shaped-value scan, and static HTTP smoke passed. Supabase host-plus-four-seat realtime smoke remains blocked by empty root config.

Task 4 follow-up: review found transport targeting and reconnect gaps. Fixed local transport identity/host discovery, same-sequence targeted resync acceptance, host hello suppression, leave envelopes, host seat release, browser room/seat-persistent identity, and stable Agent client-id requirements. Added a real `createRoomTransport` in-memory host-plus-four-seat broadcast test including disconnect/reconnect, plus UI/Agent static checks. Fresh verification: `npm test` 65 passed/0 failed; all root syntax checks, `npm run agent:step -- --help`, and `git diff --check` passed. Supabase host-plus-four-seat realtime smoke remains blocked by empty `supabase-config.js` URL/key.
