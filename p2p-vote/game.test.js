const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createState,
  createVoteEvent,
  applyEvent,
  mergeEvents,
  settle,
  meshPairs,
  encodePayload,
  decodePayload,
} = require('./game.js');

test('applying the same vote event twice is idempotent', () => {
  const state = createState(['p1', 'p2', 'p3', 'p4']);
  const event = createVoteEvent('p1', 'A', 1);

  assert.equal(applyEvent(state, event), true);
  assert.equal(applyEvent(state, event), false);
  assert.equal(Object.keys(state.events).length, 1);
  assert.equal(state.votes.p1.choice, 'A');
});

test('event merge converges regardless of arrival order and keeps the latest player vote', () => {
  const events = [
    createVoteEvent('p2', 'B', 1),
    createVoteEvent('p1', 'A', 1),
    createVoteEvent('p2', 'A', 2),
  ];
  const left = createState(['p1', 'p2']);
  const right = createState(['p1', 'p2']);

  mergeEvents(left, events);
  mergeEvents(right, [...events].reverse());

  assert.deepEqual(left.votes, right.votes);
  assert.equal(left.votes.p2.choice, 'A');
  assert.equal(Object.keys(left.events).length, 3);
});

test('settlement waits for four votes and then resolves majority or tie', () => {
  const state = createState(['p1', 'p2', 'p3', 'p4']);
  applyEvent(state, createVoteEvent('p1', 'A', 1));
  applyEvent(state, createVoteEvent('p2', 'B', 1));
  applyEvent(state, createVoteEvent('p3', 'A', 1));

  assert.deepEqual(settle(state), {
    status: 'waiting',
    missing: ['p4'],
  });

  applyEvent(state, createVoteEvent('p4', 'B', 1));
  assert.deepEqual(settle(state), {
    status: 'complete',
    winner: null,
    counts: { A: 2, B: 2 },
    tie: true,
  });

  const majority = createState(['p1', 'p2', 'p3', 'p4']);
  mergeEvents(majority, [
    createVoteEvent('p1', 'A', 1),
    createVoteEvent('p2', 'A', 1),
    createVoteEvent('p3', 'B', 1),
    createVoteEvent('p4', 'A', 1),
  ]);
  assert.deepEqual(settle(majority), {
    status: 'complete',
    winner: 'A',
    counts: { A: 3, B: 1 },
    tie: false,
  });
});

test('mesh pairing returns every direct player-to-player edge exactly once', () => {
  assert.deepEqual(meshPairs(['p1', 'p2', 'p3', 'p4']), [
    ['p1', 'p2'],
    ['p1', 'p3'],
    ['p1', 'p4'],
    ['p2', 'p3'],
    ['p2', 'p4'],
    ['p3', 'p4'],
  ]);
});

test('signal payloads survive URL-safe encoding', () => {
  const payload = { room: 'AB12-CD34', seat: 3, offer: { type: 'offer', sdp: 'a+b/中文' } };
  assert.deepEqual(decodePayload(encodePayload(payload)), payload);
});
