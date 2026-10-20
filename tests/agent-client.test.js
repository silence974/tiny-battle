const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Room = require('../supabase-room');
const { createAgentClient } = require('../agent-client');

test('agent client joins from a seat fragment and exposes compact snapshot/legal actions', async () => {
  const calls = [];
  const transport = {
    async join(options) { calls.push(['join', options]); return { seat: 2, room: 'ABCD2345' }; },
    async requestSnapshot() { calls.push(['snapshot']); return { seq: 7, phase: 'action', legalActions: [{ type: 'pass' }] }; },
    async sendCommand(command) { calls.push(['command', command]); return { accepted: true, seq: 8 }; },
    async leave() { calls.push(['leave']); },
  };
  const client = createAgentClient({
    transport,
    link: 'https://example.github.io/tiny-battle/#r=ABCD2345&s=2&t=tok-b',
    clientId: 'agent-2',
    name: 'Agent B',
  });
  assert.deepEqual(await client.join(), { seat: 2, room: 'ABCD2345' });
  assert.deepEqual(await client.snapshot(), { seq: 7, phase: 'action', legalActions: [{ type: 'pass' }] });
  assert.deepEqual(await client.legalActions(), [{ type: 'pass' }]);
  assert.deepEqual(await client.act({ type: 'pass' }), { accepted: true, seq: 8 });
  await client.leave();
  assert.deepEqual(calls.map(([name]) => name), ['join', 'snapshot', 'snapshot', 'command', 'leave']);
  assert.deepEqual(calls[0][1].seat, 2);
  assert.equal(calls[0][1].token, 'tok-b');
});

test('agent client rejects malformed seat fragments before transport access', async () => {
  const client = createAgentClient({ transport: {}, link: 'https://example.github.io/tiny-battle/', clientId: 'agent' });
  await assert.rejects(() => client.join(), /seat link/);
});

test('room parser is shared by Agent and browser links', () => {
  assert.deepEqual(Room.parseSeatFragment('#r=ROOM&s=4&t=secret'), { room: 'ROOM', seat: 4, token: 'secret' });
});

test('local Agent entrypoint requires a stable reconnect identity', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '..', 'agent-example.js'), 'utf8');
  assert.match(source, /AGENT_CLIENT_ID/);
  assert.match(source, /需要 --link、--client、--url、--key/);
  assert.doesNotMatch(source, /agent-\$\{process\.pid\}/);
});

