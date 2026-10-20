(function bootApp() {
  const Engine = window.Engine312;
  const Room = window.Room312;
  const config = window.SUPABASE_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const state = {
    mode: location.hash.startsWith('#r=') ? 'player' : 'host',
    hostId: null,
    clientId: null,
    enginePlayerId: null,
    room: null,
    roomState: null,
    game: null,
    snapshot: null,
    transport: null,
    debugChannel: null,
  };

  function setStatus(message) { $('status').textContent = message; }
  function setError(error) { $('error').textContent = error ? (error.message || String(error)) : ''; }
  function id() {
    const key = 'tiny-battle-312-client-id';
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const value = `browser-${Math.random().toString(36).slice(2, 12)}`;
    sessionStorage.setItem(key, value);
    return value;
  }
  function persistentSeatIdentity(room, seat) {
    const key = `tiny-battle-312-seat-${room}-${seat}`;
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const value = `browser-${Math.random().toString(36).slice(2, 12)}`;
    localStorage.setItem(key, value);
    return value;
  }
  function roomCode() { return Math.random().toString(36).slice(2, 10).toUpperCase(); }
  function baseUrl() { return `${location.origin}${location.pathname}`; }

  function showMode(mode) {
    state.mode = mode;
    $('host-panel').hidden = mode !== 'host';
    $('player-panel').hidden = mode !== 'player';
    if (mode === 'player' && location.hash.startsWith('#r=')) $('player-link').value = location.href;
  }

  function renderRoster(roster = []) {
    $('roster').textContent = roster.length ? roster.map((player) => `P${player.seat}: ${player.name}`).join(' · ') : '等待四个席位加入';
  }

  function renderLinks(links) {
    $('seat-links').replaceChildren(...links.map((link) => {
      const row = document.createElement('div');
      row.className = 'seat-link';
      const label = document.createElement('strong');
      label.textContent = `P${link.seat} ${link.name}`;
      const input = document.createElement('input');
      input.value = link.url;
      input.readOnly = true;
      input.size = 42;
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = '复制短链接';
      copy.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(link.url);
        setStatus(`已复制 P${link.seat} 链接`);
      });
      row.append(label, input, copy);
      return row;
    }));
  }

  function renderBoard(snapshot) {
    $('board').replaceChildren(...snapshot.board.map((tile) => {
      const cell = document.createElement('div');
      cell.className = `tile ${tile.explored ? tile.kind : 'unknown'}`;
      const owner = tile.owner ? tile.owner.toUpperCase() : '—';
      cell.textContent = `${tile.coord.join(',')} ${tile.explored ? owner : '?'}${tile.building ? ` ${tile.building}` : ''}`;
      return cell;
    }));
  }

  function renderSnapshot(snapshot) {
    if (!snapshot) return;
    state.snapshot = snapshot;
    $('game-panel').hidden = false;
    $('phase').textContent = snapshot.phase;
    $('round').textContent = snapshot.round;
    $('sequence').textContent = snapshot.seq;
    renderBoard(snapshot);
    const me = snapshot.players.find((player) => player.id === state.enginePlayerId) || snapshot.players[0];
    $('resources').textContent = JSON.stringify(me?.resources || {}, null, 2);
    $('hand').textContent = JSON.stringify(me?.hand || [], null, 2);
    const actions = snapshot.legalActions || [];
    $('legal-actions').replaceChildren(...actions.map((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.type;
      button.addEventListener('click', () => submitAction(action));
      return button;
    }));
    $('event-log').textContent = JSON.stringify(snapshot.eventLog || [], null, 2);
    const result = snapshot.outcome;
    $('outcome').textContent = result && result.status !== 'ongoing'
      ? `${result.status === 'win' ? '玩家方胜利' : '玩家方失败'}：${result.reason || ''}\n${JSON.stringify(result.ranking)}`
      : '';
  }

  async function sendEnvelope(envelope) { return state.transport.send(envelope); }

  async function broadcastState(target = null, requestId = undefined) {
    const targets = target ? [target] : [...state.roomState.players.keys()];
    for (const playerId of targets) {
      const player = state.roomState.players.get(playerId);
      await sendEnvelope(Room.makeEnvelope({
        room: state.room,
        type: 'state',
        from: state.hostId,
        to: playerId,
        requestId: requestId || undefined,
        seq: state.game.seq,
        payload: { snapshot: Engine.snapshot(state.game, player?.engineId || playerId) },
      }));
    }
    publishDebug();
  }

  async function sendRoster(target = null) {
    await sendEnvelope(Room.makeEnvelope({
      room: state.room,
      type: 'roster',
      from: state.hostId,
      to: target,
      payload: { players: [...state.roomState.players.values()].map(({ id, name, seat }) => ({ id, name, seat })) },
    }));
  }

  function settleAutomatic() {
    while (state.game.phase === 'combat' || state.game.phase === 'black') state.game = Engine.advance(state.game);
  }

  async function acceptPlayerCommand(message) {
    const player = state.roomState.players.get(message.from);
    if (!player) return;
    const command = message.payload || {};
    if (command.seq !== state.game.seq) {
      await sendEnvelope(Room.makeEnvelope({ room: state.room, type: 'reject', from: state.hostId, to: message.from, requestId: message.requestId, payload: Room.commandConflict({ expectedSeq: state.game.seq, receivedSeq: command.seq, requestId: message.requestId }) }));
      return;
    }
    try {
      state.game = Engine.applyCommand(state.game, { seq: command.seq, playerId: player.engineId, action: command.action }).state;
      settleAutomatic();
      await sendRoster();
      await broadcastState(null, message.requestId);
    } catch (error) {
      await sendEnvelope(Room.makeEnvelope({ room: state.room, type: 'reject', from: state.hostId, to: message.from, requestId: message.requestId, payload: { reason: error.message } }));
    }
  }

  async function onHello(message) {
    const join = message.payload || {};
    const result = Room.requestSeat(state.roomState, { clientId: message.from, name: join.name, seat: join.seat, token: join.token });
    if (!result.accepted) {
      await sendEnvelope(Room.makeEnvelope({ room: state.room, type: 'reject', from: state.hostId, to: message.from, requestId: message.requestId, payload: { reason: result.reason } }));
      return;
    }
    await sendRoster(message.from);
    await broadcastState(message.from, message.requestId);
    publishDebug();
  }

  async function onResync(message) { await sendRoster(message.from); await broadcastState(message.from, message.requestId); }

  async function onLeave(message) {
    if (Room.releaseSeat(state.roomState, message.from)) {
      await sendRoster();
      publishDebug();
    }
  }

  async function startHost() {
    setError(null);
    state.mode = 'host';
    state.hostId = id();
    state.clientId = state.hostId;
    state.room = roomCode();
    state.roomState = Room.createRoomState({ room: state.room, hostId: state.hostId, invites: Room.createInvites(['P1', 'P2', 'P3', 'P4']) });
    state.game = Engine.createGame({ seed: Date.now(), players: [1, 2, 3, 4].map((seat) => ({ id: `p${seat}`, name: `P${seat}`, seat })), config: window.CONFIG_312 });
    state.transport = Room.createRoomTransport({
      config,
      handlers: {
        hello: onHello,
        command: acceptPlayerCommand,
        resync: onResync,
        leave: onLeave,
      },
    });
    try {
      await state.transport.createRoom({ room: state.room, clientId: state.hostId, hostId: state.hostId, role: 'host' });
      $('room-panel').hidden = false;
      $('room-code').textContent = state.room;
      renderLinks(Room.createSeatLinks(state.roomState, baseUrl()));
      renderRoster([]);
      $('advance-phase').hidden = false;
      $('debug-link').href = `debug.html#r=${state.room}&h=${encodeURIComponent(state.hostId)}`;
      sessionStorage.setItem('tiny-battle-312-host', JSON.stringify({ room: state.room, hostId: state.hostId }));
      openDebugChannel();
      setStatus('主机已创建，等待四个席位');
      renderSnapshot(Engine.snapshot(state.game, 'p1'));
    } catch (error) { setError(error); }
  }

  async function startPlayer() {
    setError(null);
    try {
      const link = $('player-link').value.trim() || location.href;
      const seat = Room.parseSeatFragment(new URL(link).hash);
      state.room = seat.room;
      state.enginePlayerId = Room.enginePlayerId(seat.seat);
      state.clientId = `${seat.room}-seat-${seat.seat}-${persistentSeatIdentity(seat.room, seat.seat)}`;
      state.transport = Room.createRoomTransport({
        config,
        handlers: {
          roster: (message) => renderRoster(message.payload?.players || []),
          state: (message) => renderSnapshot(message.payload?.snapshot),
          reject: (message) => setError(message.payload?.reason || '请求被主机拒绝'),
        },
      });
      await state.transport.join({ room: seat.room, seat: seat.seat, token: seat.token, clientId: state.clientId, name: $('player-name').value.trim() || `P${seat.seat}` });
      $('room-panel').hidden = false;
      $('room-code').textContent = state.room;
      setStatus(`已连接到 P${seat.seat}，等待主机状态`);
    } catch (error) { setError(error); }
  }

  async function submitAction(action) {
    if (!state.snapshot || !state.transport || state.mode === 'host') return;
    try {
      await state.transport.sendCommand({ seq: state.snapshot.seq, playerId: state.enginePlayerId, action });
    } catch (error) { setError(error); }
  }

  async function advanceHost() {
    if (state.mode !== 'host' || !state.game) return;
    state.game = Engine.advance(state.game);
    settleAutomatic();
    renderSnapshot(Engine.snapshot(state.game, 'p1'));
    await sendRoster();
    await broadcastState();
  }

  function publishDebug() {
    if (!state.debugChannel || !state.game) return;
    state.debugChannel.postMessage({
      type: 'debug_state',
      hostId: state.hostId,
      room: state.room,
      seats: state.game.players.map((player) => ({ seat: player.seat, snapshot: Engine.snapshot(state.game, player.id) })),
      links: Room.createSeatLinks(state.roomState, baseUrl()),
    });
  }

  function openDebugChannel() {
    if (!('BroadcastChannel' in window)) return;
    state.debugChannel = new BroadcastChannel(`game312-debug:${state.room}`);
    state.debugChannel.onmessage = async ({ data }) => {
      if (data.type === 'debug_hello' && data.hostId === state.hostId) publishDebug();
      if (data.type === 'debug_action' && data.hostId === state.hostId) {
        try {
          const player = state.game.players.find((candidate) => candidate.seat === data.seat);
          state.game = Engine.applyCommand(state.game, { seq: data.seq, playerId: player.id, action: data.action }).state;
          settleAutomatic();
          renderSnapshot(Engine.snapshot(state.game, 'p1'));
          await broadcastState();
        } catch (error) { state.debugChannel.postMessage({ type: 'debug_error', message: error.message }); }
      }
    };
  }

  $('host-mode').addEventListener('click', () => showMode('host'));
  $('player-mode').addEventListener('click', () => showMode('player'));
  $('create-room').addEventListener('click', startHost);
  $('join-room').addEventListener('click', startPlayer);
  $('advance-phase').addEventListener('click', advanceHost);
  window.addEventListener('pagehide', () => {
    if (state.mode === 'player' && state.transport) state.transport.leave();
  });
  showMode(state.mode);
})();
