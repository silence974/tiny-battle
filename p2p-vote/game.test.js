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
  answerImportStatus,
  entryMode,
  roomMismatchMessage,
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

test('signal payloads survive URL-safe encoding', async () => {
  const payload = { room: 'AB12-CD34', seat: 3, offer: { type: 'offer', sdp: 'a+b/中文' } };
  assert.deepEqual(await decodePayload(await encodePayload(payload)), payload);
});

test('compressed payloads shorten SDP and keep legacy links readable', async () => {
  const payload = {
    room: 'AB12-CD34',
    seat: 3,
    offer: { type: 'offer', sdp: 'candidate:'.repeat(180) + 'a+b/中文' },
  };
  const legacy = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const encoded = await encodePayload(payload);

  assert.match(encoded, /^c\./);
  assert.ok(encoded.length < legacy.length);
  assert.deepEqual(await decodePayload(encoded), payload);
  assert.deepEqual(await decodePayload(legacy), payload);
});

test('answer import is accepted once and rejects duplicate or invalid signaling states', () => {
  assert.equal(answerImportStatus('have-local-offer', 'idle'), 'ok');
  assert.equal(answerImportStatus('have-local-offer', 'importing'), 'busy');
  assert.equal(answerImportStatus('stable', 'imported'), 'already-imported');
  assert.equal(answerImportStatus('stable', 'idle'), 'invalid-state');
});

test('entry mode selects host for direct access and player for signal links', () => {
  assert.equal(entryMode(''), 'host');
  assert.equal(entryMode('#join=c.payload'), 'player');
  assert.equal(entryMode('#answer=c.payload'), 'player');
  assert.equal(entryMode('?join=c.payload'), 'player');
  assert.equal(entryMode('?cache=1&join=c.payload'), 'player');
  assert.equal(entryMode('?answer=c.payload'), 'player');
  assert.equal(entryMode('#other=value'), 'host');
  assert.equal(entryMode('?other=value'), 'host');
});

test('room mismatch explains which room the answer belongs to', () => {
  assert.equal(
    roomMismatchMessage('HOST-1234', 'OLD-9876'),
    'answer 房间不匹配（当前 1234，answer 9876），请重新使用当前主机邀请',
  );
});
