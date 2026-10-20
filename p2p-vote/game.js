(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.VoteGame = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  const CHOICES = new Set(['A', 'B']);

  function assertChoice(choice) {
    if (!CHOICES.has(choice)) throw new Error(`invalid choice: ${choice}`);
  }

  function createState(players) {
    const unique = [...new Set(players)];
    if (unique.length !== players.length || unique.length === 0) {
      throw new Error('players must be a non-empty list of unique IDs');
    }
    return { players: unique, events: {}, votes: {} };
  }

  function createVoteEvent(playerId, choice, seq) {
    if (!playerId) throw new Error('playerId is required');
    assertChoice(choice);
    if (!Number.isInteger(seq) || seq < 1) throw new Error('seq must be a positive integer');
    return {
      id: `${playerId}:${seq}`,
      type: 'vote',
      playerId,
      choice,
      seq,
    };
  }

  function isNewer(candidate, current) {
    return !current || candidate.seq > current.seq ||
      (candidate.seq === current.seq && candidate.id > current.id);
  }

  function applyEvent(state, event) {
    if (!event || event.type !== 'vote' || !event.id || !event.playerId) {
      throw new Error('invalid vote event');
    }
    assertChoice(event.choice);
    if (!state.players.includes(event.playerId)) return false;
    if (state.events[event.id]) return false;
    state.events[event.id] = { ...event };
    const current = state.votes[event.playerId];
    if (isNewer(event, current)) state.votes[event.playerId] = { ...event };
    return true;
  }

  function mergeEvents(state, events) {
    for (const event of events) applyEvent(state, event);
    return state;
  }

  function settle(state) {
    const missing = state.players.filter((playerId) => !state.votes[playerId]);
    if (missing.length) return { status: 'waiting', missing };
    const counts = { A: 0, B: 0 };
    for (const playerId of state.players) counts[state.votes[playerId].choice] += 1;
    const tie = counts.A === counts.B;
    return {
      status: 'complete',
      winner: tie ? null : counts.A > counts.B ? 'A' : 'B',
      counts,
      tie,
    };
  }

  function answerImportStatus(signalingState, answerState = 'idle') {
    if (answerState === 'importing') return 'busy';
    if (answerState === 'imported') return 'already-imported';
    return signalingState === 'have-local-offer' ? 'ok' : 'invalid-state';
  }

  function entryMode(hash = '') {
    if (hash.startsWith('#join=') || hash.startsWith('#answer=')) return 'player';
    if (hash.startsWith('?')) {
      const params = new URLSearchParams(hash);
      if (params.has('join') || params.has('answer')) return 'player';
    }
    return 'host';
  }

  function roomMismatchMessage(currentRoom, answerRoom) {
    const tail = (value) => String(value || '—').slice(-4);
    return `answer 房间不匹配（当前 ${tail(currentRoom)}，answer ${tail(answerRoom)}），请重新使用当前主机邀请`;
  }

  function meshPairs(playerIds) {
    const ids = [...playerIds];
    const pairs = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) pairs.push([ids[i], ids[j]]);
    }
    return pairs;
  }

  async function transformBytes(bytes, StreamConstructor, format) {
    if (typeof StreamConstructor !== 'function' || typeof Blob !== 'function' || typeof Response !== 'function') {
      return null;
    }
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new StreamConstructor(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      return null;
    }
  }

  function encodeBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function decodeBase64Url(encoded) {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4);
    if (typeof atob === 'function') {
      const binary = atob(base64);
      return Uint8Array.from(binary, (char) => char.charCodeAt(0));
    }
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }

  async function encodePayload(payload) {
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    const compressed = await transformBytes(bytes, globalThis.CompressionStream, 'deflate');
    return `${compressed ? 'c.' : 'j.'}${encodeBase64Url(compressed || bytes)}`;
  }

  async function decodePayload(encoded) {
    const compressed = encoded.startsWith('c.');
    const body = encoded.startsWith('c.') || encoded.startsWith('j.') ? encoded.slice(2) : encoded;
    let bytes = decodeBase64Url(body);
    if (compressed) {
      bytes = await transformBytes(bytes, globalThis.DecompressionStream, 'deflate');
      if (!bytes) throw new Error('当前浏览器不支持压缩邀请链接');
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  return {
    createState,
    createVoteEvent,
    applyEvent,
    mergeEvents,
    settle,
    answerImportStatus,
    entryMode,
    roomMismatchMessage,
    meshPairs,
    encodePayload,
    decodePayload,
  };
});
