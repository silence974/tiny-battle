(function bootApp() {
  const Engine = window.Engine312;
  const Room = window.Room312;
  const config = window.SUPABASE_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  function readSeatLink(url = location.href) {
    const parsed = new URL(url);
    const query = parsed.searchParams;
    if (query.get('r') && query.get('s') && query.get('t')) {
      const seat = Number(query.get('s'));
      if (Number.isInteger(seat) && seat >= 1 && seat <= Room.PLAYER_COUNT) {
        return { room: query.get('r'), seat, token: query.get('t'), name: query.get('name') || `P${seat}` };
      }
    }
    const fragment = Room.parseSeatFragment(parsed.hash);
    return { ...fragment, name: `P${fragment.seat}` };
  }

  function hasSeatInvite() {
    try {
      readSeatLink();
      return true;
    } catch {
      return false;
    }
  }

  const state = {
    mode: hasSeatInvite() ? 'player' : 'host',
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

  const PHASE_LABELS = {
    exploration: '探索',
    production: '产出',
    purchase: '购买',
    action: '行动',
    combat: '战斗',
    black: '黑方行动',
    ended: '已结束',
  };
  const ACTION_LABELS = {
    pass: '结束行动',
    pass_purchase: '结束购牌',
    purchase_face_up: '购买明牌',
    purchase_blind: '购买盲牌',
    build: '建造',
    recruit: '招募',
    deploy: '部署兵力',
    dispatch: '派遣',
  };
  const CARD_LABELS = { farm: '农场', goldmine: '金矿', lumber: '伐木场', barracks: '兵营', monument: '纪念碑' };

  function setConnectionState(value, message) {
    const chip = $('connection-chip');
    if (!chip) return;
    chip.dataset.state = value;
    if (message) chip.textContent = message;
  }
  function setStatus(message, connection = 'connected') {
    $('status').textContent = message;
    setConnectionState(connection, message);
  }
  function setError(error) {
    $('error').textContent = error ? (error.message || String(error)) : '';
    if (error) setConnectionState('error', '连接异常');
  }
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
    $('host-panel').hidden = mode === 'player';
    $('player-panel').hidden = mode !== 'player';
  }

  function renderRoster(roster = []) {
    const players = new Map(roster.map((player) => [player.seat, player]));
    $('roster').replaceChildren(...[1, 2, 3, 4].map((seat) => {
      const player = players.get(seat);
      const card = document.createElement('div');
      card.className = `roster-seat${player ? ' is-ready' : ''}`;
      const seatLabel = document.createElement('strong');
      seatLabel.textContent = `P${seat}`;
      const playerLabel = document.createElement('span');
      playerLabel.textContent = player ? player.name : '等待加入';
      card.append(seatLabel, playerLabel);
      return card;
    }));
  }

  function renderLinks(links) {
    $('seat-links').replaceChildren(...links.map((link) => {
      const row = document.createElement('div');
      row.className = 'seat-link';
      const label = document.createElement('strong');
      label.textContent = `P${link.seat} ${link.name}`;
      const open = document.createElement('a');
      open.className = 'seat-link-open';
      open.href = link.url;
      open.target = '_blank';
      open.rel = 'noopener';
      open.textContent = '打开链接自动入座';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.textContent = '复制链接';
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard?.writeText(link.url);
          setStatus(`已复制 P${link.seat} 链接`);
        } catch {
          setError(new Error('浏览器不允许自动复制，请使用打开链接或手动复制地址'));
        }
      });
      row.append(label, open, copy);
      return row;
    }));
  }

  function renderBoard(snapshot) {
    $('board').replaceChildren(...snapshot.board.map((tile) => {
      const cell = document.createElement('div');
      const ownerClass = tile.owner ? ` owner-${tile.owner.replace('_', '-')}` : '';
      cell.className = `tile ${tile.explored ? tile.kind : 'unknown'}${ownerClass}`;
      const owner = tile.owner === 'black' ? '黑方' : tile.owner ? tile.owner.toUpperCase() : '—';
      const building = tile.building ? CARD_LABELS[tile.building] || tile.building : '';
      const garrison = tile.garrison ? Object.values(tile.garrison).reduce((sum, count) => sum + count, 0) : 0;
      const expedition = tile.expeditions?.length ? `远征 ${tile.expeditions.length}` : '';
      cell.setAttribute('aria-label', `${tile.coord.join(',')} ${tile.explored ? owner : '未知'} ${building} ${expedition}`.trim());
      const coord = document.createElement('span');
      coord.className = 'tile-coord';
      coord.textContent = tile.coord.join(',');
      const main = document.createElement('span');
      main.className = 'tile-main';
      main.textContent = tile.explored ? (tile.kind === 'black_hq' ? '黑总部' : owner) : '未知';
      const detail = document.createElement('span');
      detail.className = 'tile-detail';
      detail.textContent = building || (garrison ? `驻军 ${garrison}` : expedition);
      cell.append(coord, main, detail);
      return cell;
    }));
  }

  function formatPhase(phase) { return PHASE_LABELS[phase] || phase || '—'; }
  function countForces(forces = {}) { return Object.values(forces).reduce((sum, count) => sum + (count || 0), 0); }
  function renderResourceStrip(player) {
    const resources = player?.resources || {};
    for (const resource of ['gold', 'wood', 'food']) $(
      `resource-${resource}`
    ).textContent = resources[resource] ?? 0;
    $('resources').textContent = JSON.stringify(resources);
    $('ap-value').textContent = player?.ap ?? 0;
    $('units-value').textContent = countForces(player?.reserve);
    $('score-value').textContent = player?.score ?? 0;
  }

  function actionLabel(action) {
    const label = ACTION_LABELS[action.type] || action.type || '行动';
    if (action.card) return `${label} · ${CARD_LABELS[action.card] || action.card}`;
    if (action.building) return `${label} · ${CARD_LABELS[action.building] || action.building}`;
    if (action.unit) return `${label} · ${action.unit} ×${action.count || 1}`;
    if (action.to) return `${label} · ${action.to.join(',')}`;
    return label;
  }

  function actionMeta(action) {
    if (action.at) return `目标 ${action.at.join(',')}`;
    if (action.from && action.to) return `${action.from.join(',')} → ${action.to.join(',')}`;
    if (action.route?.length) return `路线 ${action.route.length} 格`;
    return '';
  }

  function renderHand(hand = []) {
    $('hand-count').textContent = hand.length;
    $('hand').replaceChildren(...(hand.length ? hand : []).map((card) => {
      const item = document.createElement('div');
      item.className = 'card-chip';
      const label = document.createElement('span');
      label.textContent = CARD_LABELS[card] || card;
      const code = document.createElement('small');
      code.textContent = card;
      item.append(label, code);
      return item;
    }));
    if (!hand.length) {
      const empty = document.createElement('span');
      empty.className = 'muted';
      empty.textContent = '暂无手牌';
      $('hand').append(empty);
    }
  }

  function renderActions(actions) {
    $('legal-actions').replaceChildren(...actions.map((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'action-button';
      button.dataset.actionType = action.type;
      const label = document.createElement('span');
      label.className = 'action-type';
      label.textContent = actionLabel(action);
      const meta = document.createElement('span');
      meta.className = 'action-meta';
      meta.textContent = actionMeta(action);
      button.append(label, meta);
      button.addEventListener('click', () => submitAction(action));
      return button;
    }));
    if (!actions.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.textContent = '当前没有可执行行动';
      $('legal-actions').append(empty);
    }
  }

  function renderEventLog(events = []) {
    $('event-log').replaceChildren(...(events.length ? events : []).map((event) => {
      const item = document.createElement('li');
      const label = event.type || event.name || '对局事件';
      const detail = event.card ? CARD_LABELS[event.card] || event.card : event.reason || event.resource || '';
      item.textContent = detail ? `${label} · ${typeof detail === 'object' ? JSON.stringify(detail) : detail}` : label;
      return item;
    }));
    if (!events.length) {
      const empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent = '等待第一条事件';
      $('event-log').append(empty);
    }
  }

  function renderOutcome(result) {
    const outcome = $('outcome');
    if (!result || result.status === 'ongoing') {
      outcome.textContent = '';
      return;
    }
    const title = result.status === 'win' ? '玩家方胜利' : '玩家方失败';
    const reason = result.reason ? ` · ${result.reason}` : '';
    const ranking = (result.ranking || []).map((entry) => `P${entry.playerId.replace('p', '')} ${entry.score} 分`).join('　');
    outcome.textContent = `${title}${reason}　${ranking}`;
  }

  function renderSnapshot(snapshot) {
    if (!snapshot) return;
    state.snapshot = snapshot;
    $('game-panel').hidden = false;
    $('phase').textContent = formatPhase(snapshot.phase);
    $('round').textContent = snapshot.round;
    $('sequence').textContent = snapshot.seq;
    const active = snapshot.players.find((player) => player.seat === snapshot.activeSeat);
    $('current-player').textContent = active ? `P${active.seat} ${active.name}` : '—';
    renderBoard(snapshot);
    const me = snapshot.players.find((player) => player.id === state.enginePlayerId) || snapshot.players[0];
    $('player-identity').textContent = me ? `P${me.seat} ${me.name}` : '玩家 —';
    renderResourceStrip(me);
    renderHand(me?.hand || []);
    renderActions(snapshot.legalActions || []);
    renderEventLog(snapshot.eventLog || []);
    renderOutcome(snapshot.outcome);
    setConnectionState('connected', state.mode === 'host' ? '主机在线' : state.mode === 'simulation' ? '本地模拟' : '已连接');
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

  async function onResync(message) {
    if (!state.roomState.players.has(message.from)) {
      await sendEnvelope(Room.makeEnvelope({ room: state.room, type: 'reject', from: state.hostId, to: message.from, requestId: message.requestId, payload: { reason: 'seat-not-ready' } }));
      return;
    }
    await sendRoster(message.from);
    await broadcastState(message.from, message.requestId);
  }

  async function onLeave(message) {
    if (Room.releaseSeat(state.roomState, message.from)) {
      await sendRoster();
      publishDebug();
    }
  }

  async function closeTransport() {
    if (!state.transport) return;
    try { await state.transport.close?.(); } catch { /* replace a failed connection */ }
    state.transport = null;
  }

  function setEntryBusy(busy) {
    for (const id of ['create-room', 'quick-simulate']) {
      const button = $(id);
      if (button) button.disabled = busy;
    }
  }

  function readPlayerCount() {
    const value = Number($('player-count').value);
    if (value !== Room.PLAYER_COUNT) throw new Error(`312 当前只支持 ${Room.PLAYER_COUNT} 个固定席位`);
    return value;
  }

  async function startHost() {
    setError(null);
    setEntryBusy(true);
    setStatus('正在创建房间…', 'connecting');
    try {
      readPlayerCount();
      await closeTransport();
      state.mode = 'host';
      state.hostId = id();
      state.clientId = state.hostId;
      state.enginePlayerId = 'p1';
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
      await state.transport.createRoom({ room: state.room, clientId: state.hostId, hostId: state.hostId, role: 'host' });
      $('room-panel').hidden = false;
      $('room-code').textContent = state.room;
      renderLinks(Room.createSeatLinks(state.roomState, baseUrl()));
      renderRoster([]);
      $('advance-phase').hidden = false;
      $('advance-phase').textContent = '推进阶段';
      $('debug-link').href = `debug.html#r=${state.room}&h=${encodeURIComponent(state.hostId)}`;
      sessionStorage.setItem('tiny-battle-312-host', JSON.stringify({ room: state.room, hostId: state.hostId }));
      openDebugChannel();
      setStatus('主机已创建，等待四个席位');
      renderSnapshot(Engine.snapshot(state.game, 'p1'));
    } catch (error) {
      await closeTransport();
      $('room-panel').hidden = true;
      setStatus('创建失败，请检查 Supabase 配置或网络后重试', 'error');
      setError(error);
    } finally {
      setEntryBusy(false);
    }
  }

  async function startPlayer() {
    setError(null);
    setStatus('正在读取座位链接…', 'connecting');
    try {
      const seat = readSeatLink();
      $('player-seat').textContent = `正在自动加入 P${seat.seat}（${seat.name}）…`;
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
      await state.transport.join({ room: seat.room, seat: seat.seat, token: seat.token, clientId: state.clientId, name: seat.name });
      $('room-panel').hidden = false;
      $('room-code').textContent = state.room;
      $('player-seat').textContent = `已自动加入 P${seat.seat}（${seat.name}）`;
      setStatus(`已连接到 P${seat.seat}，等待主机状态`);
    } catch (error) {
      $('player-seat').textContent = '自动入座失败，请重新打开有效的席位链接。';
      setStatus('自动入座失败，请检查链接、网络或 Supabase 配置', 'error');
      setError(error);
    }
  }

  async function startQuickSimulation() {
    setError(null);
    setEntryBusy(true);
    try {
      readPlayerCount();
      await closeTransport();
      state.mode = 'simulation';
      state.hostId = null;
      state.clientId = id();
      state.enginePlayerId = 'p1';
      state.room = null;
      state.roomState = null;
      state.game = Engine.createGame({ seed: 312, players: [1, 2, 3, 4].map((seat) => ({ id: `p${seat}`, name: `P${seat}`, seat })), config: window.CONFIG_312 });
      $('room-panel').hidden = true;
      $('advance-phase').hidden = false;
      $('advance-phase').textContent = '下一阶段';
      setStatus('快速模拟已开始，可直接查看并操作 P1');
      renderSnapshot(Engine.snapshot(state.game, 'p1'));
    } catch (error) {
      setStatus('快速模拟无法开始', 'error');
      setError(error);
    } finally {
      setEntryBusy(false);
    }
  }

  async function submitAction(action) {
    if (!state.snapshot) return;
    if (state.mode === 'simulation') {
      try {
        state.game = Engine.applyCommand(state.game, { seq: state.snapshot.seq, playerId: state.enginePlayerId, action }).state;
        settleAutomatic();
        renderSnapshot(Engine.snapshot(state.game, state.enginePlayerId));
      } catch (error) { setError(error); }
      return;
    }
    if (!state.transport || state.mode === 'host') return;
    try {
      await state.transport.sendCommand({ seq: state.snapshot.seq, playerId: state.enginePlayerId, action });
    } catch (error) { setError(error); }
  }

  async function advanceHost() {
    if (!['host', 'simulation'].includes(state.mode) || !state.game) return;
    state.game = Engine.advance(state.game);
    settleAutomatic();
    renderSnapshot(Engine.snapshot(state.game, state.enginePlayerId || 'p1'));
    if (state.mode === 'host') {
      await sendRoster();
      await broadcastState();
    }
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

  $('create-room').addEventListener('click', startHost);
  $('quick-simulate').addEventListener('click', startQuickSimulation);
  $('advance-phase').addEventListener('click', advanceHost);
  window.addEventListener('pagehide', () => {
    if (state.mode === 'player' && state.transport) state.transport.leave();
  });
  showMode(state.mode);
  if (state.mode === 'player') void startPlayer();
})();
