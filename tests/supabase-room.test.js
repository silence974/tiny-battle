const test = require('node:test');
const assert = require('node:assert/strict');

const Room = require('../supabase-room');

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

