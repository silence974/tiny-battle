const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateConfig,
  roomTopic,
  createRoomState,
  allocateSeat,
  releaseSeat,
  makeSignal,
  acceptSignal,
} = require('./signaling.js');

test('validates a public Supabase config and rejects missing or secret keys', () => {
  assert.deepEqual(
    validateConfig({
      url: 'https://example.supabase.co',
      publishableKey: 'sb_publishable_test',
    }),
    { ok: true },
  );
  assert.equal(validateConfig({ url: '', publishableKey: 'sb_publishable_test' }).ok, false);
  assert.equal(validateConfig({ url: 'not-a-url', publishableKey: 'sb_publishable_test' }).ok, false);
  assert.equal(validateConfig({ url: 'https://example.supabase.co', publishableKey: 'service_role_secret' }).ok, false);
});

test('builds a stable room topic', () => {
  assert.equal(roomTopic('ABCD2345'), 'room:ABCD2345');
});

test('allocates four deterministic seats and rejects a fifth player', () => {
  const state = createRoomState('ABCD2345', 'host-1');
  for (let seat = 1; seat <= 4; seat += 1) {
    assert.deepEqual(allocateSeat(state, { id: `p${seat}`, name: `P${seat}` }), {
      accepted: true,
      seat,
    });
  }
  assert.deepEqual(allocateSeat(state, { id: 'p5', name: 'P5' }), {
    accepted: false,
    reason: 'room-full',
  });
  assert.equal(state.players.size, 4);
});

test('releasing a player makes the lowest free seat reusable', () => {
  const state = createRoomState('ABCD2345', 'host-1');
  allocateSeat(state, { id: 'p1', name: 'P1' });
  allocateSeat(state, { id: 'p2', name: 'P2' });
  assert.equal(releaseSeat(state, 'p1'), true);
  assert.equal(releaseSeat(state, 'missing'), false);
  assert.deepEqual(allocateSeat(state, { id: 'p3', name: 'P3' }), {
    accepted: true,
    seat: 1,
  });
});

test('creates and accepts a targeted signal once', () => {
  const signal = makeSignal({
    room: 'ABCD2345',
    from: 'host-1',
    to: 'p1',
    id: 'signal-1',
    type: 'offer',
    payload: { type: 'offer', sdp: 'test' },
  });
  assert.deepEqual(signal, {
    room: 'ABCD2345',
    from: 'host-1',
    to: 'p1',
    id: 'signal-1',
    type: 'offer',
    payload: { type: 'offer', sdp: 'test' },
  });

  const seen = new Set();
  assert.deepEqual(acceptSignal(seen, signal, { room: 'ABCD2345', localId: 'p1' }), { accepted: true });
  assert.deepEqual(acceptSignal(seen, signal, { room: 'ABCD2345', localId: 'p1' }), {
    accepted: false,
    reason: 'duplicate',
  });
});

test('rejects signals for another room or target', () => {
  const signal = makeSignal({
    room: 'ABCD2345',
    from: 'host-1',
    to: 'p1',
    id: 'signal-1',
    type: 'answer',
    payload: {},
  });
  assert.deepEqual(acceptSignal(new Set(), signal, { room: 'OLDROOM', localId: 'p1' }), {
    accepted: false,
    reason: 'wrong-room',
  });
  assert.deepEqual(acceptSignal(new Set(), signal, { room: 'ABCD2345', localId: 'p2' }), {
    accepted: false,
    reason: 'wrong-target',
  });
});
