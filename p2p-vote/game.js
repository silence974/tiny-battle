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

  function meshPairs(playerIds) {
    const ids = [...playerIds];
    const pairs = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) pairs.push([ids[i], ids[j]]);
    }
    return pairs;
  }

  function encodePayload(payload) {
    const text = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const base64 = typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function decodePayload(encoded) {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4);
    let bytes;
    if (typeof atob === 'function') {
      const binary = atob(base64);
      bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    } else {
      bytes = Uint8Array.from(Buffer.from(base64, 'base64'));
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  return {
    createState,
    createVoteEvent,
    applyEvent,
    mergeEvents,
    settle,
    meshPairs,
    encodePayload,
    decodePayload,
  };
});
