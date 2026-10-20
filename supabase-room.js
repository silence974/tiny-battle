(function attachRoom(globalScope) {
  const PLAYER_COUNT = 4;
  const PROTOCOL = '312-web-1';

  function fail(message) {
    return { ok: false, message };
  }

  function validateConfig(config) {
    if (!config || typeof config !== 'object') return fail('缺少 Supabase 配置');
    let parsed;
    try {
      parsed = new URL(String(config.url || ''));
    } catch {
      return fail('Supabase Project URL 格式无效');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) return fail('Supabase Project URL 必须使用 HTTP(S)');
    const publishableKey = String(config.publishableKey || '').trim();
    if (!publishableKey) return fail('请填写 Supabase publishable key');
    if (/secret|service_role/i.test(publishableKey)) return fail('浏览器配置不能使用 secret 或 service_role key');
    return { ok: true };
  }

  function roomTopic(room) {
    return `game312:${String(room || '').trim()}`;
  }

  function enginePlayerId(seat) {
    const value = Number(seat);
    if (!Number.isInteger(value) || value < 1 || value > PLAYER_COUNT) throw new Error('无效的引擎席位');
    return `p${value}`;
  }

  function token(seed) {
    if (seed) return String(seed);
    if (globalScope?.crypto?.getRandomValues) {
      const bytes = new Uint8Array(9);
      globalScope.crypto.getRandomValues(bytes);
      return [...bytes].map((value) => value.toString(36).padStart(2, '0')).join('').slice(0, 12);
    }
    return Math.random().toString(36).slice(2, 14);
  }

  function normalizeInvites(invites) {
    if (!Array.isArray(invites) || invites.length !== PLAYER_COUNT) throw new Error('需要四个席位邀请');
    const seats = new Set();
    const tokens = new Set();
    return invites.map((raw) => {
      const seat = Number(raw?.seat);
      const name = String(raw?.name || `Player ${seat}`).trim();
      const inviteToken = String(raw?.token || '').trim();
      if (!Number.isInteger(seat) || seat < 1 || seat > PLAYER_COUNT || !inviteToken) throw new Error('席位邀请格式无效');
      if (seats.has(seat) || tokens.has(inviteToken)) throw new Error('席位邀请不能重复');
      seats.add(seat);
      tokens.add(inviteToken);
      return { seat, name, token: inviteToken };
    });
  }

  function createInvites(names = [], tokens = []) {
    return Array.from({ length: PLAYER_COUNT }, (_, index) => ({
      seat: index + 1,
      name: String(names[index] || `Player ${index + 1}`),
      token: token(tokens[index]),
    }));
  }

  function createRoomState({ room, hostId, invites = createInvites() }) {
    return {
      protocol: PROTOCOL,
      room: String(room),
      hostId: String(hostId),
      hostOnline: true,
      invites: new Map(normalizeInvites(invites).map((invite) => [invite.seat, invite])),
      players: new Map(),
      lastSeq: 0,
    };
  }

  function createSeatLinks(state, origin) {
    const base = new URL(origin || 'http://localhost/');
    base.search = '';
    base.hash = '';
    return [...state.invites.values()].sort((a, b) => a.seat - b.seat).map((invite) => {
      const url = new URL(base.toString());
      url.hash = `r=${encodeURIComponent(state.room)}&s=${invite.seat}&t=${encodeURIComponent(invite.token)}`;
      return { seat: invite.seat, name: invite.name, url: url.toString() };
    });
  }

  function parseSeatFragment(fragment) {
    const value = String(fragment || '').replace(/^#/, '');
    const params = new URLSearchParams(value);
    const room = params.get('r');
    const seat = Number(params.get('s'));
    const tokenValue = params.get('t');
    if (!room || !Number.isInteger(seat) || seat < 1 || seat > PLAYER_COUNT || !tokenValue) throw new Error('无效的 seat link');
    return { room, seat, token: tokenValue };
  }

  function requestSeat(state, { clientId, name, seat, token: inviteToken }) {
    const id = String(clientId || '').trim();
    const requestedSeat = Number(seat);
    const invite = state.invites.get(requestedSeat);
    if (!id) return { accepted: false, reason: 'invalid-client' };
    if (!invite) return { accepted: false, reason: 'invalid-seat' };
    if (invite.token !== String(inviteToken || '')) return { accepted: false, reason: 'invalid-token' };
    const existingId = [...state.players.entries()].find(([, player]) => player.seat === requestedSeat)?.[0];
    if (existingId && existingId !== id) return { accepted: false, reason: 'seat-taken' };
    const existing = state.players.get(id);
    if (existing && existing.seat !== requestedSeat) return { accepted: false, reason: 'identity-already-seated' };
    state.players.set(id, { id, engineId: enginePlayerId(requestedSeat), name: invite.name || name || id, seat: requestedSeat, token: invite.token, connected: true });
    return { accepted: true, seat: requestedSeat, reconnected: Boolean(existing) };
  }

  function releaseSeat(state, clientId) {
    return state.players.delete(String(clientId));
  }

  function makeEnvelope({ room, type, from, to = null, requestId = token(), seq = null, payload = null }) {
    return { protocol: PROTOCOL, room, type, from, to, requestId, seq, payload };
  }

  function acceptEnvelope(seen, envelope, context) {
    if (!envelope || envelope.protocol !== PROTOCOL || !envelope.requestId) return { accepted: false, reason: 'invalid-envelope' };
    if (envelope.room !== context.room) return { accepted: false, reason: 'wrong-room' };
    if (envelope.to && envelope.to !== context.localId) return { accepted: false, reason: 'wrong-target' };
    if (seen.has(envelope.requestId)) return { accepted: false, reason: 'duplicate' };
    if (envelope.type === 'state' && Number.isInteger(context.lastSeq) && envelope.seq < context.lastSeq) return { accepted: false, reason: 'stale-sequence' };
    seen.add(envelope.requestId);
    return { accepted: true };
  }

  function commandConflict({ expectedSeq, receivedSeq, requestId }) {
    return { type: 'reject', requestId, reason: 'sequence-conflict', expectedSeq, receivedSeq };
  }

  function createRoomTransport(options = {}) {
    let channel = null;
    let client = options.client || null;
    let context = null;
    const seen = new Set();
    const waiters = new Map();
    const handlers = options.handlers || {};
    let joinReady = null;

    async function ensureClient() {
      const config = options.config || globalScope?.SUPABASE_CONFIG;
      const validation = validateConfig(config);
      if (!validation.ok) throw new Error(validation.message);
      client = client || globalScope?.supabase?.createClient(config.url, config.publishableKey);
      if (!client) throw new Error('缺少 Supabase 浏览器客户端');
      if (client.auth?.signInAnonymously) {
        const result = await client.auth.signInAnonymously();
        if (result.error) throw new Error(`Supabase 匿名登录失败: ${result.error.message}`);
        const accessToken = result.data?.session?.access_token;
        if (accessToken && client.realtime?.setAuth) client.realtime.setAuth(accessToken);
      }
      return client;
    }

    function handle(payload) {
      if (payload?.from === context?.localId) return;
      if (payload?.type === 'state' && payload.from) context.hostId = payload.from;
      const verdict = acceptEnvelope(seen, payload, context);
      if (!verdict.accepted) return;
      if (payload.type === 'state' && Number.isInteger(payload.seq)) context.lastSeq = payload.seq;
      if (joinReady && payload.requestId === joinReady.requestId) {
        const pending = joinReady;
        joinReady = null;
        if (payload.type === 'reject') pending.reject(new Error(payload.payload?.reason || payload.reason || 'join rejected'));
        else if (payload.type === 'state') pending.resolve(payload.payload?.snapshot || payload.payload || payload);
      }
      const waiter = waiters.get(payload.requestId);
      if (waiter) {
        waiters.delete(payload.requestId);
        if (payload.type === 'reject') waiter.reject(new Error(payload.reason || 'command rejected'));
        else waiter.resolve(payload.payload?.snapshot || payload.payload || payload);
      }
      const handler = handlers[payload.type] || handlers.message;
      if (handler) handler(payload);
    }

    async function joinRoom(joinOptions) {
      const supabase = await ensureClient();
      context = { ...joinOptions, room: String(joinOptions.room), localId: String(joinOptions.clientId), lastSeq: 0 };
      channel = supabase.channel(roomTopic(context.room), { config: { private: true } });
      channel.on('broadcast', { event: 'game312' }, ({ payload }) => handle(payload));
      await new Promise((resolve, reject) => {
        channel.subscribe((status) => {
          if (status === 'SUBSCRIBED') resolve();
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error(`Supabase channel ${status}`));
        });
      });
      if (context.role !== 'host') {
        const requestId = token();
        const ready = new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            if (joinReady?.requestId === requestId) joinReady = null;
            reject(new Error('join confirmation timeout'));
          }, 10_000);
          joinReady = {
            requestId,
            resolve: (value) => { clearTimeout(timer); resolve(value); },
            reject: (error) => { clearTimeout(timer); reject(error); },
          };
        });
        try {
          await send(makeEnvelope({ room: context.room, type: 'hello', from: context.clientId, to: context.hostId || null, requestId, payload: { seat: context.seat, token: context.token, name: context.name } }));
          await ready;
        } finally {
          if (joinReady?.requestId === requestId) joinReady = null;
        }
      }
      return context;
    }

    async function send(envelope) {
      if (!channel) throw new Error('room is not connected');
      return channel.send({ type: 'broadcast', event: 'game312', payload: envelope });
    }

    async function requestSnapshot() {
      const requestId = token();
      const pending = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(requestId);
          reject(new Error('resync timeout'));
        }, 10_000);
        waiters.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      });
      await send(makeEnvelope({ room: context.room, type: 'resync', from: context.clientId, to: context.hostId || null, requestId, seq: context.lastSeq, payload: {} }));
      return pending;
    }

    async function close() {
      if (joinReady) {
        joinReady.reject(new Error('room closed during join'));
        joinReady = null;
      }
      if (channel && context) {
        try {
          await send(makeEnvelope({ room: context.room, type: 'leave', from: context.clientId, payload: {} }));
        } catch {
          // Cleanup must still detach the channel when the network is already gone.
        }
      }
      if (channel && client?.removeChannel) await client.removeChannel(channel);
      channel = null;
      context = null;
    }

    async function sendCommand(command) {
      const requestId = command.requestId || token();
      const pending = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(requestId);
          reject(new Error('command timeout'));
        }, 10_000);
        waiters.set(requestId, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      });
      await send(makeEnvelope({ room: context.room, type: 'command', from: context.clientId, to: context.hostId || null, seq: command.seq, requestId, payload: command }));
      return pending;
    }

    return {
      createRoom: joinRoom,
      joinRoom,
      join: joinRoom,
      send,
      sendCommand,
      requestSnapshot,
      leave: close,
      close,
      get context() { return context; },
    };
  }

  const api = {
    PLAYER_COUNT,
    PROTOCOL,
    validateConfig,
    roomTopic,
    enginePlayerId,
    createInvites,
    createRoomState,
    createSeatLinks,
    parseSeatFragment,
    requestSeat,
    releaseSeat,
    makeEnvelope,
    acceptEnvelope,
    commandConflict,
    createRoomTransport,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.Room312 = api;
})(typeof window !== 'undefined' ? window : globalThis);
