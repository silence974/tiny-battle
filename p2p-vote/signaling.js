(() => {
  const PLAYER_COUNT = 4;

  function fail(message) {
    return { ok: false, message };
  }

  function validateConfig(config) {
    if (!config || typeof config !== 'object') return fail('缺少 Supabase 配置');
    if (!String(config.url || '').trim()) return fail('请填写 Supabase Project URL');
    let parsed;
    try {
      parsed = new URL(config.url);
    } catch {
      return fail('Supabase Project URL 格式无效');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return fail('Supabase Project URL 必须使用 HTTP(S)');
    const key = String(config.publishableKey || '').trim();
    if (!key) return fail('请填写 Supabase publishable key');
    if (/secret|service_role/i.test(key)) return fail('浏览器配置不能使用 secret 或 service_role key');
    return { ok: true };
  }

  function roomTopic(room) {
    return `room:${String(room || '').trim()}`;
  }

  function createRoomState(room, hostId) {
    return {
      room,
      hostId,
      players: new Map(),
      nextSeat: 1,
    };
  }

  function updateNextSeat(state) {
    for (let seat = 1; seat <= PLAYER_COUNT; seat += 1) {
      if (![...state.players.values()].some((player) => player.seat === seat)) {
        state.nextSeat = seat;
        return;
      }
    }
    state.nextSeat = PLAYER_COUNT + 1;
  }

  function allocateSeat(state, player) {
    if (!player || !String(player.id || '').trim()) return { accepted: false, reason: 'invalid-player' };
    if (state.players.has(player.id)) return { accepted: false, reason: 'already-joined' };
    updateNextSeat(state);
    if (state.nextSeat > PLAYER_COUNT) return { accepted: false, reason: 'room-full' };
    const seat = state.nextSeat;
    state.players.set(player.id, { ...player, seat });
    updateNextSeat(state);
    return { accepted: true, seat };
  }

  function releaseSeat(state, playerId) {
    const removed = state.players.delete(playerId);
    if (removed) updateNextSeat(state);
    return removed;
  }

  function makeSignal({ room, from, to = null, id, type, payload }) {
    return { room, from, to, id, type, payload };
  }

  function acceptSignal(seenIds, signal, context) {
    if (!signal || !signal.id) return { accepted: false, reason: 'invalid-signal' };
    if (signal.room !== context.room) return { accepted: false, reason: 'wrong-room' };
    if (signal.to && signal.to !== context.localId) return { accepted: false, reason: 'wrong-target' };
    if (seenIds.has(signal.id)) return { accepted: false, reason: 'duplicate' };
    seenIds.add(signal.id);
    return { accepted: true };
  }

  const api = {
    validateConfig,
    roomTopic,
    createRoomState,
    allocateSeat,
    releaseSeat,
    makeSignal,
    acceptSignal,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Signaling = api;
})();
