(() => {
  const PLAYER_COUNT = 4;
  const JOIN_TIMEOUT_MS = 10_000;
  const SEAT_NAMES = ['A', 'B', 'C', 'D'];

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

  function defaultSeatNames() {
    return [...SEAT_NAMES];
  }

  function createInvites(names = defaultSeatNames(), tokens = []) {
    if (!Array.isArray(names) || names.length !== PLAYER_COUNT) throw new Error('需要四个席位昵称');
    if (!Array.isArray(tokens) || tokens.length !== PLAYER_COUNT) throw new Error('需要四个席位 token');
    return names.map((rawName, index) => {
      const name = String(rawName || '').trim() || SEAT_NAMES[index];
      const token = String(tokens[index] || '').trim();
      if (!token) throw new Error(`席位 ${index + 1} 缺少邀请 token`);
      return { seat: index + 1, name, token };
    });
  }

  function createRoomState(room, hostId) {
    return {
      room,
      hostId,
      players: new Map(),
      invites: new Map(),
      nextSeat: 1,
    };
  }

  function setRoomInvites(state, invites) {
    if (!state || !Array.isArray(invites) || invites.length !== PLAYER_COUNT) {
      throw new Error('需要四个席位邀请');
    }
    const seats = new Set();
    const tokens = new Set();
    const normalized = invites.map((invite) => {
      const seat = Number(invite?.seat);
      const name = String(invite?.name || '').trim();
      const token = String(invite?.token || '').trim();
      if (!Number.isInteger(seat) || seat < 1 || seat > PLAYER_COUNT || !name || !token) {
        throw new Error('席位邀请格式无效');
      }
      if (seats.has(seat) || tokens.has(token)) throw new Error('席位邀请不能重复');
      seats.add(seat);
      tokens.add(token);
      return { seat, name, token };
    });
    if (seats.size !== PLAYER_COUNT) throw new Error('席位邀请必须覆盖四个席位');
    state.invites = new Map(normalized.map((invite) => [invite.seat, invite]));
    return state;
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
    const playerId = String(player?.playerId || player?.id || '').trim();
    if (!playerId) return { accepted: false, reason: 'invalid-player' };
    if (state.players.has(playerId)) return { accepted: false, reason: 'already-joined' };
    const seat = Number(player?.seat);
    const invite = state.invites.get(seat);
    if (!invite || invite.token !== String(player?.inviteToken || '').trim()) {
      return { accepted: false, reason: 'invalid-invite' };
    }
    if ([...state.players.values()].some((candidate) => candidate.seat === seat)) {
      return { accepted: false, reason: 'seat-taken' };
    }
    state.players.set(playerId, { ...player, id: playerId, name: invite.name, seat });
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
    defaultSeatNames,
    createInvites,
    createRoomState,
    setRoomInvites,
    allocateSeat,
    releaseSeat,
    makeSignal,
    acceptSignal,
    JOIN_TIMEOUT_MS,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.Signaling = api;
})();
