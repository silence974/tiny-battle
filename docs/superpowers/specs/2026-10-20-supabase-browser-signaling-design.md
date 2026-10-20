# Supabase browser signaling for p2p-vote

## Goal

Replace the current manual invite/answer URL exchange in `p2p-vote` with a
Supabase Realtime signaling channel while keeping the game itself browser
based and statically deployable on GitHub Pages.

The room owner remains a coordinator, not one of the four player seats. The
four players run the game rules in their own browsers. Supabase is used only
for room discovery and WebRTC signaling; game events continue over the
player-to-player WebRTC DataChannels.

## Scope

In scope:

- A browser-safe Supabase configuration containing only the project URL and
  publishable key.
- Supabase anonymous authentication and a private Realtime channel per room.
- Host-created rooms with four player seats, player join by room code and
  nickname, and deterministic seat assignment.
- Broadcast signaling messages for `join`, `roster`, `offer`, `answer`,
  `ice-candidate`, and `leave`.
- Idempotent signal/event handling, reconnect cleanup, and user-facing errors
  for missing configuration, authentication failure, invalid room, or a full
  room.
- README instructions for Supabase setup and GitHub Pages deployment.
- Unit tests for configuration, room/seat state, message routing, and cleanup;
  Node syntax/static smoke checks remain required.

Out of scope for this change:

- Persisting rooms or game state in Postgres.
- Resuming a room after a refresh or host departure.
- TURN deployment or relay fallback.
- Server-authoritative game rules, anti-cheat, or server-side scoring.
- Changes to the game rules or the existing player-to-player vote protocol.

## Architecture and data flow

1. `index.html` loads the Supabase browser client and the app bundle. A
   runtime configuration module exposes `SUPABASE_URL` and
   `SUPABASE_PUBLISHABLE_KEY`; missing values produce an actionable setup
   message. No secret or service-role key is shipped to the browser.
2. On host start, the app creates a high-entropy room code, signs in
   anonymously, and joins a private topic such as `room:<room-code>`.
3. A player enters the room code and nickname. The host allocates an unused
   seat and broadcasts the roster through Supabase.
4. The host and player exchange WebRTC descriptions and ICE candidates over
   the private topic. Signal IDs and peer IDs are used to ignore duplicates.
5. Once player-to-player links are open, the existing DataChannel mesh carries
   roster snapshots and vote events. Supabase is no longer on the game-event
   path.
6. Closing the page or leaving the room broadcasts `leave` and removes the
   local Realtime channel. The MVP treats the room as ended when its host
   leaves; no persistence or host migration is implied.

## Supabase authorization

The project must enable Anonymous Auth and private Realtime channels. RLS on
`realtime.messages` must allow authenticated anonymous users to insert and
select broadcast messages only for the room topic they joined. The client
must set `config.private: true`. A high-entropy room code is an additional
locator, not the authorization mechanism.

## Error handling

- Missing URL/key: do not attempt a network connection; show the exact config
  file and fields to fill.
- Anonymous sign-in failure: show that Anonymous Auth must be enabled.
- Channel timeout/closed: show a reconnect/keep-host-open status and clean up
  stale peer entries.
- Full or unknown room: reject the join without creating a WebRTC peer.
- Duplicate or stale signals: ignore them safely and keep the current peer
  state unchanged.

## Acceptance criteria

- A configured GitHub Pages build lets one host create a room and four players
  join without manually copying invite/answer URLs.
- All four players can establish their existing direct mesh and vote.
- A fifth player is rejected as full; duplicate signals do not break an
  established connection.
- An unconfigured build explains the required Supabase settings instead of
  failing silently.
- Tests and static checks pass, and the README tells the project owner exactly
  which Supabase settings and GitHub Pages settings to configure.
