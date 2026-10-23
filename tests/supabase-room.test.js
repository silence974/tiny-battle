const test = require('node:test');
const assert = require('node:assert/strict');

const Room = require('../supabase-room');
const Engine = require('../engine312');

function room() {
  return Room.createRoomState({
    room: 'ABCD2345',
    hostId: 'host-1',
    invites: [
      { seat: 1, name: 'A', token: 'tok-a' },
      { seat: 2, name: 'B', token: 'tok-b' },
      { seat: 3, name: 'C', token: 'tok-c' },
      { seat: 4, name: 'D', token: 'tok-d' },
    ],
  });
}

test('validates public Supabase config and rejects secret-shaped keys', () => {
  assert.deepEqual(Room.validateConfig({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' }), { ok: true });
  assert.equal(Room.validateConfig({ url: '', publishableKey: 'sb_publishable_test' }).ok, false);
  assert.equal(Room.validateConfig({ url: 'not-a-url', publishableKey: 'sb_publishable_test' }).ok, false);
  assert.equal(Room.validateConfig({ url: 'https://example.supabase.co', publishableKey: 'service_role_secret' }).ok, false);
});

test('creates stable fixed-seat compact links without putting tokens in query requests', () => {
  const state = room();
  const first = Room.createSeatLinks(state, 'https://example.github.io/tiny-battle/');
  const second = Room.createSeatLinks(state, 'https://example.github.io/tiny-battle/');
  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.equal(first[0].seat, 1);
  assert.match(first[0].url, /#r=ABCD2345&s=1&t=tok-a$/);
  assert.equal(new URL(first[0].url).search, '');
  assert.deepEqual(Room.parseSeatFragment(new URL(first[0].url).hash), { room: 'ABCD2345', seat: 1, token: 'tok-a' });
  assert.deepEqual(Room.parseSeatFragment(new URL(first[3].url).hash), { room: 'ABCD2345', seat: 4, token: 'tok-d' });
});

test('fixed tokens claim one seat, allow same-identity reconnect, and reject conflicts', () => {
  const state = room();
  assert.deepEqual(Room.requestSeat(state, { clientId: 'browser-a', name: 'Alice', seat: 1, token: 'tok-a' }), { accepted: true, seat: 1, reconnected: false });
  assert.deepEqual(Room.requestSeat(state, { clientId: 'agent-a', name: 'Agent', seat: 1, token: 'tok-a' }), { accepted: false, reason: 'seat-taken' });
  assert.deepEqual(Room.requestSeat(state, { clientId: 'browser-a', name: 'Alice', seat: 1, token: 'tok-a' }), { accepted: true, seat: 1, reconnected: true });
  assert.deepEqual(Room.requestSeat(state, { clientId: 'browser-b', name: 'Bob', seat: 2, token: 'wrong' }), { accepted: false, reason: 'invalid-token' });
});

test('rejects fifth seat, invalid seats, and host seat claims', () => {
  const state = room();
  for (let seat = 1; seat <= 4; seat += 1) Room.requestSeat(state, { clientId: `p${seat}`, name: `P${seat}`, seat, token: `tok-${String.fromCharCode(96 + seat)}` });
  assert.deepEqual(Room.requestSeat(state, { clientId: 'p5', name: 'P5', seat: 1, token: 'tok-a' }), { accepted: false, reason: 'seat-taken' });
  assert.deepEqual(Room.requestSeat(state, { clientId: 'p6', name: 'P6', seat: 5, token: 'tok-e' }), { accepted: false, reason: 'invalid-seat' });
  assert.equal(state.players.size, 4);
});

test('releasing a seat allows the same fixed link to be reused', () => {
  const state = room();
  Room.requestSeat(state, { clientId: 'p1', name: 'P1', seat: 1, token: 'tok-a' });
  assert.equal(Room.releaseSeat(state, 'p1'), true);
  assert.equal(Room.releaseSeat(state, 'missing'), false);
  assert.deepEqual(Room.requestSeat(state, { clientId: 'p2', name: 'P2', seat: 1, token: 'tok-a' }), { accepted: true, seat: 1, reconnected: false });
});

test('envelope validation rejects wrong room, target, duplicate request, and stale state', () => {
  const envelope = Room.makeEnvelope({ room: 'ABCD2345', type: 'command', from: 'p1', to: 'host-1', requestId: 'req-1', seq: 3, payload: { action: { type: 'pass' } } });
  assert.deepEqual(Room.acceptEnvelope(new Set(), envelope, { room: 'OLD', localId: 'host-1', lastSeq: 2 }), { accepted: false, reason: 'wrong-room' });
  assert.deepEqual(Room.acceptEnvelope(new Set(), envelope, { room: 'ABCD2345', localId: 'p2', lastSeq: 2 }), { accepted: false, reason: 'wrong-target' });
  const seen = new Set();
  assert.deepEqual(Room.acceptEnvelope(seen, envelope, { room: 'ABCD2345', localId: 'host-1', lastSeq: 2 }), { accepted: true });
  assert.deepEqual(Room.acceptEnvelope(seen, envelope, { room: 'ABCD2345', localId: 'host-1', lastSeq: 2 }), { accepted: false, reason: 'duplicate' });
  const stale = Room.makeEnvelope({ ...envelope, requestId: 'req-2', seq: 2, type: 'state' });
  assert.deepEqual(Room.acceptEnvelope(new Set(), stale, { room: 'ABCD2345', localId: 'host-1', lastSeq: 3 }), { accepted: false, reason: 'stale-sequence' });
});

test('same-seat concurrent commands are represented as a sequence conflict', () => {
  const conflict = Room.commandConflict({ expectedSeq: 9, receivedSeq: 8, requestId: 'req-agent' });
  assert.deepEqual(conflict, { type: 'reject', requestId: 'req-agent', reason: 'sequence-conflict', expectedSeq: 9, receivedSeq: 8 });
});

test('seat identities map to stable engine players for a four-seat host round trip', () => {
  assert.equal(Room.enginePlayerId(1), 'p1');
  assert.equal(Room.enginePlayerId(4), 'p4');
  const state = room();
  for (let seat = 1; seat <= 4; seat += 1) {
    const result = Room.requestSeat(state, { clientId: `client-${seat}`, name: `P${seat}`, seat, token: `tok-${String.fromCharCode(96 + seat)}` });
    assert.equal(result.accepted, true);
    assert.equal(Room.enginePlayerId(result.seat), `p${seat}`);
  }
});

test('host command round trip accepts one pass from each fixed seat without client-id lookup errors', () => {
  const state = room();
  let game = Engine.createGame({ seed: 9, players: [1, 2, 3, 4].map((seat) => ({ id: `p${seat}`, seat })) });
  game.phase = 'action';
  game.activeSeat = 1;
  for (const player of game.players) { player.ap = 3; player.passed = false; }
  for (let seat = 1; seat <= 4; seat += 1) {
    Room.requestSeat(state, { clientId: `browser-${seat}`, name: `P${seat}`, seat, token: `tok-${String.fromCharCode(96 + seat)}` });
    const seated = state.players.get(`browser-${seat}`);
    assert.doesNotThrow(() => {
      game = Engine.applyCommand(game, { seq: game.seq, playerId: seated.engineId, action: { type: 'pass' } }).state;
    });
  }
  assert.equal(game.players[0].ap, 0);
  assert.equal(game.seq, 4);
});

test('anonymous session JWT is forwarded to Supabase Realtime auth', async () => {
  let realtimeToken = null;
  const channel = {
    on() { return this; },
    subscribe(callback) { callback('SUBSCRIBED'); return this; },
    async send() { return 'ok'; },
  };
  const client = {
    auth: { signInAnonymously: async () => ({ data: { session: { access_token: 'jwt-anonymous-test' } }, error: null }) },
    realtime: { setAuth(token) { realtimeToken = token; } },
    channel() { return channel; },
    async removeChannel() {},
  };
  const transport = Room.createRoomTransport({ client, config: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' } });
  await transport.join({ room: 'ABCD2345', seat: 1, token: 'tok-a', clientId: 'client-a', name: 'A', role: 'host' });
  assert.equal(realtimeToken, 'jwt-anonymous-test');
  await transport.leave();
});

test('browser-created transports reuse a persisted anonymous session across room tabs', async () => {
  const previousSupabase = globalThis.supabase;
  const previousConfig = globalThis.SUPABASE_CONFIG;
  let receivedOptions;
  const channel = {
    on() { return this; },
    subscribe(callback) { callback('SUBSCRIBED'); return this; },
    async send() { return 'ok'; },
  };
  globalThis.SUPABASE_CONFIG = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' };
  globalThis.supabase = {
    createClient(_url, _key, options) {
      receivedOptions = options;
      return {
        auth: { signInAnonymously: async () => ({ error: null }) },
        channel() { return channel; },
        async removeChannel() {},
      };
    },
  };
  try {
    const transport = Room.createRoomTransport();
    await transport.join({ room: 'ROOM-A', clientId: 'host-a', hostId: 'host-a', role: 'host' });
    assert.deepEqual(receivedOptions, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    await transport.leave();
  } finally {
    globalThis.supabase = previousSupabase;
    globalThis.SUPABASE_CONFIG = previousConfig;
  }
});

test('existing anonymous session skips another rate-limited sign-in', async () => {
  let signIns = 0;
  let realtimeToken = null;
  const channel = {
    on() { return this; },
    subscribe(callback) { callback('SUBSCRIBED'); return this; },
    async send() { return 'ok'; },
  };
  const client = {
    auth: {
      async getSession() { return { data: { session: { access_token: 'existing-jwt' } }, error: null }; },
      async signInAnonymously() { signIns += 1; return { error: null }; },
    },
    realtime: { setAuth(token) { realtimeToken = token; } },
    channel() { return channel; },
    async removeChannel() {},
  };
  const transport = Room.createRoomTransport({ client, config: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' } });
  await transport.join({ room: 'ROOM-A', clientId: 'host-a', hostId: 'host-a', role: 'host' });
  assert.equal(signIns, 0);
  assert.equal(realtimeToken, 'existing-jwt');
  await transport.leave();
});

test('persisted access token avoids a second sign-in while another tab hydrates auth', async () => {
  const previousSupabase = globalThis.supabase;
  const previousConfig = globalThis.SUPABASE_CONFIG;
  const previousStorage = globalThis.localStorage;
  let signIns = 0;
  let realtimeToken = null;
  const channel = {
    on() { return this; },
    subscribe(callback) { callback('SUBSCRIBED'); return this; },
    async send() { return 'ok'; },
  };
  globalThis.SUPABASE_CONFIG = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' };
  globalThis.localStorage = {
    getItem(key) {
      return key === 'sb-example-auth-token' ? JSON.stringify({ access_token: 'persisted-jwt', expires_at: Math.floor(Date.now() / 1000) + 300 }) : null;
    },
  };
  globalThis.supabase = {
    createClient() {
      return {
        auth: {
          async getSession() { return { data: { session: null }, error: null }; },
          async signInAnonymously() { signIns += 1; return { error: null }; },
        },
        realtime: { setAuth(token) { realtimeToken = token; } },
        channel() { return channel; },
        async removeChannel() {},
      };
    },
  };
  try {
    const transport = Room.createRoomTransport();
    await transport.join({ room: 'ROOM-A', clientId: 'host-a', hostId: 'host-a', role: 'host' });
    assert.equal(signIns, 0);
    assert.equal(realtimeToken, 'persisted-jwt');
    await transport.leave();
  } finally {
    globalThis.supabase = previousSupabase;
    globalThis.SUPABASE_CONFIG = previousConfig;
    globalThis.localStorage = previousStorage;
  }
});

test('Realtime subscription errors preserve the provider diagnostic', async () => {
  const channel = {
    on() { return this; },
    subscribe(callback) { callback('CHANNEL_ERROR', { message: 'MissingPartition: test partition' }); return this; },
  };
  const client = {
    auth: { signInAnonymously: async () => ({ data: { session: { access_token: 'jwt' } }, error: null }) },
    realtime: { setAuth() {} },
    channel() { return channel; },
  };
  const transport = Room.createRoomTransport({ client, config: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' } });
  await assert.rejects(() => transport.join({ room: 'ABCD2345', clientId: 'host-1', hostId: 'host-1', role: 'host' }), /MissingPartition: test partition/);
});

test('transport send rejects a non-ok Realtime result instead of silently waiting', async () => {
  const channel = {
    on() { return this; },
    subscribe(callback) { callback('SUBSCRIBED'); return this; },
    async send() { return { status: 'error', error: 'transport failure' }; },
  };
  const client = {
    auth: { signInAnonymously: async () => ({ error: null }) },
    channel() { return channel; },
    async removeChannel() {},
  };
  const transport = Room.createRoomTransport({ client, config: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' } });
  await transport.join({ room: 'ABCD2345', clientId: 'host-1', hostId: 'host-1', role: 'host' });
  await assert.rejects(() => transport.send(Room.makeEnvelope({ room: 'ABCD2345', type: 'roster', from: 'host-1' })), /transport failure/);
  await transport.leave();
});

test('sendCommand clears its waiter when Realtime rejects the send', async () => {
  const channel = {
    on() { return this; },
    subscribe(callback) { callback('SUBSCRIBED'); return this; },
    async send() { return { status: 'error', error: { message: 'transport failure' } }; },
  };
  const client = {
    auth: { signInAnonymously: async () => ({ error: null }) },
    channel() { return channel; },
    async removeChannel() {},
  };
  const transport = Room.createRoomTransport({ client, config: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' } });
  await transport.join({ room: 'ABCD2345', clientId: 'client-a', hostId: 'client-a', role: 'host' });
  const started = Date.now();
  await assert.rejects(() => transport.sendCommand({ seq: 0, action: { type: 'pass' } }), /transport failure/);
  assert.ok(Date.now() - started < 1_000, 'send failure should not wait for command timeout');
  await transport.leave();
});

test('requestSnapshot also reports a Realtime send failure immediately', async () => {
  const channel = {
    on() { return this; },
    subscribe(callback) { callback('SUBSCRIBED'); return this; },
    async send() { return { status: 'error', error: { message: 'transport failure' } }; },
  };
  const client = {
    auth: { signInAnonymously: async () => ({ error: null }) },
    channel() { return channel; },
    async removeChannel() {},
  };
  const transport = Room.createRoomTransport({ client, config: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' } });
  await transport.join({ room: 'ABCD2345', clientId: 'client-a', hostId: 'host-a', role: 'host' });
  const started = Date.now();
  await assert.rejects(() => transport.requestSnapshot(), /transport failure/);
  assert.ok(Date.now() - started < 1_000, 'resync failure should not wait for timeout');
  await transport.leave();
});

test('room transport retries a transient channel failure before giving up', async () => {
  let subscriptions = 0;
  const removed = [];
  const client = {
    auth: { signInAnonymously: async () => ({ error: null }) },
    channel() {
      subscriptions += 1;
      const attempt = subscriptions;
      return {
        on() { return this; },
        subscribe(callback) {
          if (attempt === 1) callback('CHANNEL_ERROR', { message: 'transport failure' });
          else callback('SUBSCRIBED');
          return this;
        },
      };
    },
    async removeChannel(channel) { removed.push(channel); },
  };
  const transport = Room.createRoomTransport({ client, config: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' } });
  await transport.join({ room: 'ROOM-A', clientId: 'host-a', hostId: 'host-a', role: 'host' });
  assert.equal(subscriptions, 2);
  assert.equal(removed.length, 1);
  await transport.leave();
});

test('player join waits for the host seat confirmation snapshot', async () => {
  const channels = [];
  const client = {
    auth: { signInAnonymously: async () => ({ error: null }) },
    channel(topic) {
      const channel = {
        topic,
        handlers: [],
        on(_kind, _filter, handler) { this.handlers.push(handler); return this; },
        subscribe(callback) { callback('SUBSCRIBED'); return this; },
        send(message) {
          for (const peer of channels.filter((candidate) => candidate.topic === topic)) {
            for (const handler of peer.handlers) Promise.resolve().then(() => handler({ payload: message.payload }));
          }
          return 'ok';
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) { channels.splice(channels.indexOf(channel), 1); },
  };
  let releaseState;
  const stateReady = new Promise((resolve) => { releaseState = resolve; });
  let helloReceived;
  const helloSeen = new Promise((resolve) => { helloReceived = resolve; });
  let host;
  const roomState = room();
  host = Room.createRoomTransport({ client, config: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' }, handlers: {
    hello: async (message) => {
      const result = Room.requestSeat(roomState, { clientId: message.from, ...message.payload });
      assert.equal(result.accepted, true);
      helloReceived();
      await stateReady;
      await host.send(Room.makeEnvelope({ room: roomState.room, type: 'state', from: 'host-1', to: message.from, requestId: message.requestId, seq: 0, payload: { snapshot: { seq: 0 } } }));
    },
  } });
  await host.createRoom({ room: roomState.room, clientId: 'host-1', hostId: 'host-1', role: 'host' });
  const player = Room.createRoomTransport({ client, config: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' } });
  let joined = false;
  const joining = player.join({ room: roomState.room, seat: 1, token: 'tok-a', clientId: 'client-a', name: 'A' }).then(() => { joined = true; });
  await helloReceived;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(joined, false);
  releaseState();
  await joining;
  assert.equal(joined, true);
  await player.leave();
  await host.leave();
});

test('player join and resync accept an explicit waiting-for-seats response', async () => {
  const channels = [];
  const client = {
    auth: { signInAnonymously: async () => ({ error: null }) },
    channel(topic) {
      const channel = {
        topic,
        handlers: [],
        on(_kind, _filter, handler) { this.handlers.push(handler); return this; },
        subscribe(callback) { callback('SUBSCRIBED'); return this; },
        async send(message) {
          for (const peer of channels.filter((candidate) => candidate.topic === topic)) {
            for (const handler of peer.handlers) await handler({ payload: message.payload });
          }
          return 'ok';
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) { channels.splice(channels.indexOf(channel), 1); },
  };
  const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' };
  const roomState = room();
  let host;
  const waiting = (message) => host.send(Room.makeEnvelope({
    room: roomState.room,
    type: 'waiting',
    from: 'host-1',
    to: message.from,
    requestId: message.requestId,
    seq: 0,
    payload: { joined: roomState.players.size, required: Room.PLAYER_COUNT, started: false },
  }));
  host = Room.createRoomTransport({ client, config, handlers: {
    hello: async (message) => {
      const result = Room.requestSeat(roomState, { clientId: message.from, ...message.payload });
      assert.equal(result.accepted, true);
      await waiting(message);
    },
    resync: waiting,
  } });
  await host.createRoom({ room: roomState.room, clientId: 'host-1', hostId: 'host-1', role: 'host' });
  const player = Room.createRoomTransport({ client, config });

  await player.join({ room: roomState.room, seat: 1, token: 'tok-a', clientId: 'client-a', name: 'A' });
  const snapshot = await player.requestSnapshot();
  assert.deepEqual(snapshot, { joined: 1, required: Room.PLAYER_COUNT, started: false });

  await player.leave();
  await host.leave();
});

test('real transport broadcast loopback routes targeted state and commands for host plus four seats', async () => {
  const channels = [];
  const client = {
    auth: { signInAnonymously: async () => ({ error: null }) },
    channel(topic) {
      const channel = {
        topic,
        handlers: [],
        on(_kind, _filter, handler) { this.handlers.push(handler); return this; },
        subscribe(callback) { callback('SUBSCRIBED'); return this; },
        async send(message) {
          for (const peer of channels.filter((candidate) => candidate.topic === topic)) {
            for (const handler of peer.handlers) await handler({ payload: message.payload });
          }
          return 'ok';
        },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) { channels.splice(channels.indexOf(channel), 1); },
  };
  const config = { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' };
  const roomState = room();
  const snapshots = new Map();
  const received = new Map();
  let game = Engine.createGame({ seed: 12, players: [1, 2, 3, 4].map((seat) => ({ id: `p${seat}`, seat })) });
  game.phase = 'action';
  game.activeSeat = 1;
  for (const player of game.players) { player.ap = 3; player.passed = false; }
  let host;
  const sendState = async (target, requestId) => host.send(Room.makeEnvelope({ room: roomState.room, type: 'state', from: 'host-1', to: target, requestId, seq: game.seq, payload: { snapshot: Engine.snapshot(game, Room.enginePlayerId(roomState.players.get(target).seat)) } }));
  host = Room.createRoomTransport({ client, config, handlers: {
    hello: async (message) => {
      const join = message.payload;
      const accepted = Room.requestSeat(roomState, { clientId: message.from, ...join });
      assert.equal(accepted.accepted, true);
      await sendState(message.from, message.requestId);
    },
    resync: async (message) => sendState(message.from, message.requestId),
    command: async (message) => {
      const player = roomState.players.get(message.from);
      game = Engine.applyCommand(game, { seq: message.payload.seq, playerId: player.engineId, action: message.payload.action }).state;
      for (const target of roomState.players.keys()) {
        await sendState(target, target === message.from ? message.requestId : undefined);
      }
    },
    leave: async (message) => { Room.releaseSeat(roomState, message.from); },
  } });
  await host.createRoom({ room: roomState.room, clientId: 'host-1', hostId: 'host-1', role: 'host' });
  const players = [];
  for (let seat = 1; seat <= 4; seat += 1) {
    received.set(`client-${seat}`, []);
    const transport = Room.createRoomTransport({ client, config, handlers: { state: (message) => { received.get(`client-${seat}`).push(message.payload.snapshot.seq); snapshots.set(`client-${seat}`, message.payload.snapshot); } } });
    players.push({ seat, transport, clientId: `client-${seat}` });
    await transport.join({ room: roomState.room, seat, token: `tok-${String.fromCharCode(96 + seat)}`, clientId: `client-${seat}`, name: `P${seat}` });
  }
  for (const player of players) {
    await player.transport.sendCommand({ seq: game.seq, action: { type: 'pass' } });
  }
  assert.equal(game.seq, 4);
  assert.equal(game.phase, 'combat');
  assert.equal(game.players.every((player) => player.passed), false);
  assert.equal(snapshots.size, 4);
  assert.equal([...snapshots.values()].every((snapshot) => snapshot.seq === 4), true, JSON.stringify([...received.entries()]));
  const resynced = await players[0].transport.requestSnapshot();
  assert.equal(resynced.seq, 4);

  await players[0].transport.leave();
  assert.equal(roomState.players.has('client-1'), false);
  const replacement = Room.createRoomTransport({ client, config, handlers: {
    state: (message) => { snapshots.set('client-1-reconnected', message.payload.snapshot); },
  } });
  await replacement.join({ room: roomState.room, seat: 1, token: 'tok-a', clientId: 'client-1', name: 'P1 again' });
  assert.equal(snapshots.get('client-1-reconnected').seq, 4);
  await replacement.leave();
});

test('transport leave releases a seat so a refreshed client can reclaim the same invite', async () => {
  const sent = [];
  const channel = { on() { return this; }, subscribe(callback) { callback('SUBSCRIBED'); return this; }, async send(message) { sent.push(message.payload); return 'ok'; } };
  const client = { auth: { signInAnonymously: async () => ({ error: null }) }, channel() { return channel; }, async removeChannel() {} };
  const state = room();
  const transport = Room.createRoomTransport({ client, config: { url: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' } });
  await transport.join({ room: state.room, seat: 1, token: 'tok-a', clientId: 'client-a', name: 'A', role: 'host' });
  Room.requestSeat(state, { clientId: 'client-a', seat: 1, token: 'tok-a' });
  await transport.leave();
  assert.equal(sent.some((message) => message.type === 'leave' && message.from === 'client-a'), true);
  assert.equal(Room.releaseSeat(state, 'client-a'), true);
  assert.equal(Room.requestSeat(state, { clientId: 'client-b', seat: 1, token: 'tok-a' }).accepted, true);
});

