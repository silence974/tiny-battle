const test = require('node:test');
const assert = require('node:assert/strict');

const {
  validateConfig,
  roomTopic,
  createRoomState,
  defaultSeatNames,
  createInvites,
  setRoomInvites,
  allocateSeat,
  releaseSeat,
  makeSignal,
  acceptSignal,
  JOIN_TIMEOUT_MS,
} = require('./signaling.js');

test('uses a bounded wait for a room response', () => {
  assert.equal(JOIN_TIMEOUT_MS, 10_000);
});

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

test('builds four fixed-seat invites with default names and host overrides', () => {
  assert.deepEqual(defaultSeatNames(), ['A', 'B', 'C', 'D']);
  assert.deepEqual(
    createInvites(['Alice', '', 'Carol', 'Dana'], ['token-a', 'token-b', 'token-c', 'token-d']),
    [
      { seat: 1, name: 'Alice', token: 'token-a' },
      { seat: 2, name: 'B', token: 'token-b' },
      { seat: 3, name: 'Carol', token: 'token-c' },
      { seat: 4, name: 'Dana', token: 'token-d' },
    ],
  );
});

test('only the matching invite can claim its fixed seat once', () => {
  const state = createRoomState('ABCD2345', 'host-1');
  setRoomInvites(state, createInvites(defaultSeatNames(), ['a', 'b', 'c', 'd']));

  assert.deepEqual(allocateSeat(state, { playerId: 'p2', seat: 2, inviteToken: 'b' }), {
    accepted: true,
    seat: 2,
  });
  assert.equal(state.players.get('p2').name, 'B');
  assert.deepEqual(allocateSeat(state, { playerId: 'p1', seat: 1, inviteToken: 'wrong' }), {
    accepted: false,
    reason: 'invalid-invite',
  });
  assert.deepEqual(allocateSeat(state, { playerId: 'p3', seat: 2, inviteToken: 'b' }), {
    accepted: false,
    reason: 'seat-taken',
  });
});

test('rejects incomplete or duplicate seat invite bundles', () => {
  const state = createRoomState('ABCD2345', 'host-1');
  assert.throws(() => setRoomInvites(state, createInvites(['A', 'B', 'C', 'D'], ['a', 'a', 'c', 'd'])), /不能重复/);
  assert.throws(() => setRoomInvites(state, [{ seat: 1, name: 'A', token: 'a' }]), /需要四个席位邀请/);
});

test('allocates four deterministic seats and rejects a fifth player', () => {
  const state = createRoomState('ABCD2345', 'host-1');
  setRoomInvites(state, createInvites(defaultSeatNames(), ['a', 'b', 'c', 'd']));
  for (let seat = 1; seat <= 4; seat += 1) {
    assert.deepEqual(allocateSeat(state, { playerId: `p${seat}`, seat, inviteToken: ['a', 'b', 'c', 'd'][seat - 1] }), {
      accepted: true,
      seat,
    });
  }
  assert.deepEqual(allocateSeat(state, { playerId: 'p5', seat: 1, inviteToken: 'a' }), {
    accepted: false,
    reason: 'seat-taken',
  });
  assert.equal(state.players.size, 4);
});

test('allocates a fixed seat from the playerId field used by join signals', () => {
  const state = createRoomState('ABCD2345', 'host-1');
  setRoomInvites(state, createInvites(defaultSeatNames(), ['token-a', 'token-b', 'token-c', 'token-d']));

  assert.deepEqual(allocateSeat(state, { playerId: 'p1', seat: 1, inviteToken: 'token-a' }), {
    accepted: true,
    seat: 1,
  });
  assert.equal(state.players.has('p1'), true);
});

test('releasing a player makes the lowest free seat reusable', () => {
  const state = createRoomState('ABCD2345', 'host-1');
  setRoomInvites(state, createInvites(defaultSeatNames(), ['a', 'b', 'c', 'd']));
  allocateSeat(state, { playerId: 'p1', seat: 1, inviteToken: 'a' });
  allocateSeat(state, { playerId: 'p2', seat: 2, inviteToken: 'b' });
  assert.equal(releaseSeat(state, 'p1'), true);
  assert.equal(releaseSeat(state, 'missing'), false);
  assert.deepEqual(allocateSeat(state, { playerId: 'p3', seat: 1, inviteToken: 'a' }), {
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
