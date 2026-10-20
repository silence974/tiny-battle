/* global VoteGame, Signaling, supabase, SUPABASE_CONFIG */

(() => {
  const { createState, createVoteEvent, applyEvent, mergeEvents, settle } = window.VoteGame;
  const { validateConfig, roomTopic, createRoomState, allocateSeat, releaseSeat, makeSignal, acceptSignal } = window.Signaling;
  const NO_PUBLIC_SERVERS = { iceServers: [] };
  const PLAYER_COUNT = 4;
  const $ = (id) => document.getElementById(id);
  const ui = {
    role: $('role'), room: $('room'), status: $('status'), hostCard: $('host-card'), playerCard: $('player-card'),
    hostPanel: $('host-panel'), playerPanel: $('player-panel'), gamePanel: $('game-panel'), hostRoomCode: $('host-room-code'),
    hostWaiting: $('host-waiting'), playerName: $('player-name'), roomCode: $('room-code'), playerWaiting: $('player-waiting'),
    startHost: $('start-host'), joinRoom: $('join-room'), roster: $('roster'), topology: $('topology'), result: $('result'),
    voteA: $('vote-a'), voteB: $('vote-b'),
  };
  const localKey = 'mesh-vote-player-id';
  const state = {
    role: null, room: null, hostId: null, playerId: null, playerName: '', seat: null,
    hostPeers: new Map(), peers: new Map(), players: new Map(), game: null, sequence: 0,
    meshStarted: false, meshReady: false, roomState: null, signaling: null, signalCounter: 0, signalSeen: new Set(),
  };

  function randomId(prefix) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }

  function localPlayerId() {
    let id = sessionStorage.getItem(localKey);
    if (!id) {
      id = randomId('p');
      sessionStorage.setItem(localKey, id);
    }
    return id;
  }

  function roomCode() {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
  }

  function setStatus(message, tone = '') {
    ui.status.textContent = message;
    ui.status.dataset.tone = tone;
  }

  function log(message) {
    console.info('[mesh-vote]', message);
  }

  function setRoom(room) {
    state.room = room;
    ui.room.textContent = room || '—';
  }

  function signalSourceId() {
    return state.role === 'host' ? state.hostId : state.playerId;
  }

  function waitIceComplete(pc, timeoutMs = 6000) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onState);
        resolve();
      };
      const onState = () => {
        if (pc.iceGatheringState === 'complete') finish();
      };
      const timer = setTimeout(finish, timeoutMs);
      pc.addEventListener('icegatheringstatechange', onState);
    });
  }

  async function sendSignal({ to = null, type, payload }) {
    const channel = state.signaling?.channel;
    if (!channel || !state.room) return false;
    const signal = makeSignal({ room: state.room, from: signalSourceId(), to, id: `${signalSourceId()}-${++state.signalCounter}`, type, payload });
    const result = await channel.send({ type: 'broadcast', event: 'signal', payload: signal });
    if (result?.error) throw result.error;
    return true;
  }

  async function startSignaling() {
    const configResult = validateConfig(window.SUPABASE_CONFIG);
    if (!configResult.ok) throw new Error(`${configResult.message}（编辑 supabase-config.js）`);
    if (!window.supabase?.createClient) throw new Error('Supabase 客户端未加载，请检查网络或 CDN 配置');
    const client = window.supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.publishableKey);
    const { data, error } = await client.auth.signInAnonymously();
    if (error) throw new Error(`Supabase 匿名登录失败：${error.message}（请在 Auth 中启用 Anonymous sign-ins）`);
    if (data?.session?.access_token) client.realtime.setAuth(data.session.access_token);
    const channel = client
      .channel(roomTopic(state.room), { config: { private: true } })
      .on('broadcast', { event: 'signal' }, ({ payload }) => {
        handleSignal(payload).catch((signalError) => log(`处理信令失败：${signalError.message}`));
      });
    await new Promise((resolve, reject) => {
      channel.subscribe((status, subscribeError) => {
        if (status === 'SUBSCRIBED') resolve();
        else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) reject(subscribeError || new Error(`Realtime channel ${status}`));
      });
    });
    state.signaling = { client, channel };
  }

  async function stopSignaling(notify = true) {
    const signaling = state.signaling;
    if (!signaling) return;
    if (notify && state.role && state.room) {
      try {
        await sendSignal({ type: 'leave', payload: { playerId: state.playerId, seat: state.seat } });
      } catch (error) {
        log(`离开信令房间失败：${error.message}`);
      }
    }
    state.signaling = null;
    await signaling.client.removeChannel(signaling.channel);
  }

  function createPeerConnection(entry) {
    const pc = new RTCPeerConnection(NO_PUBLIC_SERVERS);
    entry.pc = pc;
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(pc.connectionState)) log(`连接状态：${pc.connectionState}`);
      renderTopology();
    };
    return pc;
  }

  function attachChannel(entry, channel) {
    entry.channel = channel;
    channel.onopen = () => {
      log(`${entry.kind === 'host' ? '主机' : '玩家'}连接已打开${entry.peerId ? `：${entry.peerId}` : ''}`);
      if (state.role === 'player' && entry.kind === 'host') send(entry, { type: 'hello', playerId: state.playerId, name: state.playerName, seat: state.seat });
      renderTopology();
    };
    channel.onclose = () => {
      log(`连接已关闭${entry.peerId ? `：${entry.peerId}` : ''}`);
      renderTopology();
    };
    channel.onerror = () => log(`连接错误${entry.peerId ? `：${entry.peerId}` : ''}`);
    channel.onmessage = (event) => {
      try {
        handleMessage(entry, JSON.parse(event.data));
      } catch (error) {
        log(`忽略无效消息：${error.message}`);
      }
    };
  }

  function send(entry, message) {
    if (!entry || !entry.channel || entry.channel.readyState !== 'open') return false;
    entry.channel.send(JSON.stringify(message));
    return true;
  }

  async function createHostPeer(playerId, name, seat) {
    const entry = { kind: 'host', seat, peerId: playerId, name, pc: null, channel: null, answerState: 'idle' };
    const pc = createPeerConnection(entry);
    attachChannel(entry, pc.createDataChannel('control'));
    state.hostPeers.set(seat, entry);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);
    await sendSignal({ to: playerId, type: 'offer', payload: { hostId: state.hostId, seat, offer: pc.localDescription } });
  }

  async function importAnswer(entry, payload) {
    if (!entry) throw new Error('找不到对应席位');
    if (entry.answerState === 'importing') throw new Error('该席位的 answer 正在导入，请稍候');
    if (entry.answerState === 'imported') return;
    if (entry.pc.signalingState !== 'have-local-offer') throw new Error(`当前无法导入 answer（${entry.pc.signalingState}）`);
    entry.answerState = 'importing';
    try {
      await entry.pc.setRemoteDescription(payload.answer);
      entry.answerState = 'imported';
    } catch (error) {
      entry.answerState = 'idle';
      throw error;
    }
  }

  async function joinAsPlayer() {
    const room = ui.roomCode.value.trim().toUpperCase();
    if (!room) throw new Error('请输入房间码');
    state.role = 'player';
    state.playerId = localPlayerId();
    state.playerName = ui.playerName.value.trim() || '未命名玩家';
    setRoom(room);
    ui.role.textContent = '玩家（等待入座）';
    ui.hostCard.hidden = true;
    ui.playerPanel.hidden = false;
    ui.joinRoom.disabled = true;
    setStatus('正在连接信令服务…');
    try {
      await startSignaling();
      await sendSignal({ type: 'join', payload: { playerId: state.playerId, name: state.playerName } });
      ui.playerWaiting.textContent = '已申请入座，等待房主发送连接信息。';
      setStatus('已申请入座，等待房主。', 'ready');
    } catch (error) {
      ui.joinRoom.disabled = false;
      await stopSignaling(false);
      throw error;
    }
  }

  async function startHost() {
    state.role = 'host';
    state.hostId = randomId('host');
    setRoom(roomCode());
    state.roomState = createRoomState(state.room, state.hostId);
    ui.role.textContent = '房主（非投票席）';
    ui.hostPanel.hidden = false;
    ui.playerCard.hidden = false;
    ui.startHost.disabled = true;
    ui.hostRoomCode.textContent = state.room;
    setStatus('正在连接信令服务…');
    try {
      await startSignaling();
      ui.hostWaiting.textContent = '等待四位玩家输入房间码加入。';
      setStatus('房间已创建，等待玩家加入。', 'ready');
    } catch (error) {
      ui.startHost.disabled = false;
      await stopSignaling(false);
      throw error;
    }
  }

  async function handleSignal(signal) {
    const verdict = acceptSignal(state.signalSeen, signal, { room: state.room, localId: signalSourceId() });
    if (!verdict.accepted) return;
    if (signal.type === 'join' && state.role === 'host') {
      const allocation = allocateSeat(state.roomState, signal.payload);
      if (!allocation.accepted) {
        await sendSignal({ to: signal.from, type: 'reject', payload: { reason: allocation.reason } });
        return;
      }
      await createHostPeer(signal.from, signal.payload.name, allocation.seat);
      return;
    }
    if (signal.type === 'offer' && state.role === 'player' && signal.to === state.playerId) {
      state.hostId = signal.from;
      state.seat = signal.payload.seat;
      ui.role.textContent = `玩家 ${state.seat}`;
      const entry = { kind: 'host', peerId: 'host', pc: null, channel: null };
      const pc = createPeerConnection(entry);
      pc.ondatachannel = ({ channel }) => attachChannel(entry, channel);
      state.peers.set('host', entry);
      await pc.setRemoteDescription(signal.payload.offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIceComplete(pc);
      await sendSignal({
        to: state.hostId,
        type: 'answer',
        payload: { playerId: state.playerId, name: state.playerName, seat: state.seat, answer: pc.localDescription },
      });
      ui.playerWaiting.textContent = '已回传连接信息，等待连接建立。';
      return;
    }
    if (signal.type === 'answer' && state.role === 'host' && signal.to === state.hostId) {
      const entry = [...state.hostPeers.values()].find((candidate) => candidate.peerId === signal.from);
      await importAnswer(entry, signal.payload);
      return;
    }
    if (signal.type === 'reject' && state.role === 'player' && signal.to === state.playerId) {
      const reason = signal.payload?.reason === 'room-full' ? '房间已满' : '房主拒绝了加入请求';
      ui.joinRoom.disabled = false;
      setStatus(reason, 'error');
      await stopSignaling(false);
      return;
    }
    if (signal.type === 'leave' && state.role === 'host') {
      const playerId = signal.payload?.playerId || signal.from;
      const entry = [...state.hostPeers.values()].find((candidate) => candidate.peerId === playerId);
      if (entry?.pc) entry.pc.close();
      if (entry) state.hostPeers.delete(entry.seat);
      releaseSeat(state.roomState, playerId);
    }
  }

  function hostEntryForPlayer(playerId) {
    return [...state.hostPeers.values()].find((entry) => entry.peerId === playerId);
  }

  function sendToHost(message) { return send(state.peers.get('host'), message); }
  function sendToPlayer(playerId, message) { return send(hostEntryForPlayer(playerId), message); }
  function connectedPlayerIds() { return [...state.players.keys()].sort(); }

  function registerPlayer(entry, message) {
    entry.peerId = message.playerId;
    entry.name = message.name;
    entry.seat = message.seat;
    state.peers.set(message.playerId, entry);
    state.players.set(message.playerId, { id: message.playerId, name: message.name, seat: message.seat });
    sendRoster();
    if (state.players.size === PLAYER_COUNT && !state.meshStarted) {
      state.meshStarted = true;
      startMeshNegotiation();
    }
    renderRoster();
    renderTopology();
  }

  function sendRoster() {
    const players = [...state.players.values()].sort((a, b) => a.seat - b.seat);
    const events = state.game ? Object.values(state.game.events) : [];
    state.game = createState(players.map((player) => player.id));
    mergeEvents(state.game, events);
    for (const entry of state.hostPeers.values()) {
      send(entry, { type: 'roster', room: state.room, players });
      send(entry, { type: 'snapshot', events: Object.values(state.game.events) });
    }
    renderGame();
  }

  function startMeshNegotiation() {
    const ids = connectedPlayerIds();
    const pairs = [];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) pairs.push([ids[i], ids[j]]);
    }
    for (const [from, to] of pairs) sendToPlayer(from, { type: 'mesh-start', targetId: to });
    log(`四席已齐，自动协商 ${pairs.length} 条玩家直连。`);
  }

  function playerEntry(peerId, kind = 'mesh') { return state.peers.get(peerId) || { kind, peerId, pc: null, channel: null }; }

  async function startMeshOffer(targetId) {
    if (state.peers.get(targetId)?.channel?.readyState === 'open') return;
    const entry = playerEntry(targetId);
    entry.kind = 'mesh';
    const pc = createPeerConnection(entry);
    const channel = pc.createDataChannel('game');
    attachChannel(entry, channel);
    state.peers.set(targetId, entry);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);
    sendToHost({ type: 'mesh-signal', from: state.playerId, to: targetId, description: pc.localDescription });
  }

  async function acceptMeshSignal(message) {
    const targetId = message.from;
    let entry = state.peers.get(targetId);
    if (message.description.type === 'offer') {
      if (!entry || entry.kind !== 'mesh') {
        entry = { kind: 'mesh', peerId: targetId, pc: null, channel: null };
        const pc = createPeerConnection(entry);
        pc.ondatachannel = ({ channel }) => attachChannel(entry, channel);
        state.peers.set(targetId, entry);
      }
      await entry.pc.setRemoteDescription(message.description);
      const answer = await entry.pc.createAnswer();
      await entry.pc.setLocalDescription(answer);
      await waitIceComplete(entry.pc);
      sendToHost({ type: 'mesh-signal', from: state.playerId, to: targetId, description: entry.pc.localDescription });
    } else if (message.description.type === 'answer' && entry) await entry.pc.setRemoteDescription(message.description);
    renderTopology();
  }

  function relayMeshSignal(message) {
    if (state.role !== 'host') return;
    sendToPlayer(message.to, { type: 'mesh-signal', from: message.from, description: message.description });
  }

  function broadcast(message, exceptPeerId = null) {
    for (const [peerId, entry] of state.peers.entries()) if (peerId !== exceptPeerId) send(entry, message);
  }

  function receiveVote(event, fromPeerId) {
    if (!state.game || !applyEvent(state.game, event)) return;
    broadcast({ type: 'vote', event }, fromPeerId);
    renderGame();
  }

  function handleMessage(entry, message) {
    if (message.type === 'hello' && state.role === 'host') {
      registerPlayer(entry, message);
      return;
    }
    if (message.type === 'roster' && state.role === 'player') {
      state.players = new Map(message.players.map((player) => [player.id, player]));
      const events = state.game ? Object.values(state.game.events) : [];
      state.game = createState(message.players.map((player) => player.id));
      mergeEvents(state.game, events);
      renderRoster();
      renderGame();
      return;
    }
    if (message.type === 'snapshot') {
      if (!state.game && state.players.size) state.game = createState([...state.players.keys()]);
      if (state.game) {
        for (const event of message.events || []) applyEvent(state.game, event);
        renderGame();
      }
      return;
    }
    if (message.type === 'mesh-start' && state.role === 'player') {
      startMeshOffer(message.targetId).catch((error) => log(`建立直连失败：${error.message}`));
      return;
    }
    if (message.type === 'mesh-signal') {
      if (state.role === 'host') relayMeshSignal(message);
      else acceptMeshSignal(message).catch((error) => log(`处理直连信令失败：${error.message}`));
      return;
    }
    if (message.type === 'vote') receiveVote(message.event, entry.peerId);
  }

  function renderRoster() {
    ui.roster.replaceChildren();
    for (const player of [...state.players.values()].sort((a, b) => a.seat - b.seat)) {
      const item = document.createElement('li');
      const vote = state.game?.votes[player.id];
      item.textContent = `P${player.seat} ${player.name}${vote ? `：已投 ${vote.choice}` : '：待投票'}`;
      ui.roster.append(item);
    }
  }

  function renderTopology() {
    if (state.role === 'player') {
      const directOpen = [...state.peers.values()].filter((entry) => entry.kind === 'mesh' && entry.channel?.readyState === 'open').length;
      const directTotal = PLAYER_COUNT - 1;
      const ready = state.players.size === PLAYER_COUNT && directOpen === directTotal;
      ui.topology.textContent = ready
        ? `玩家直连 ${directOpen}/${directTotal} · 可关闭主机`
        : `玩家直连 ${directOpen}/${directTotal} · ${directOpen === directTotal ? '等待玩家名单' : '保持主机打开'}`;
      if (ready && !state.meshReady) {
        state.meshReady = true;
        setStatus('直连完成，可关闭主机。', 'ready');
      } else if (!ready) state.meshReady = false;
      return;
    }
    const open = [...state.hostPeers.values()].filter((entry) => entry.channel?.readyState === 'open').length;
    ui.topology.textContent = `主机连接 ${open}/${PLAYER_COUNT}`;
  }

  function renderGame() {
    if (state.role === 'host') {
      ui.gamePanel.hidden = true;
      return;
    }
    if (!state.game) return;
    const seated = state.players.size === PLAYER_COUNT;
    ui.playerCard.hidden = seated;
    ui.gamePanel.hidden = !seated;
    if (!seated) return;
    const result = settle(state.game);
    renderRoster();
    if (result.status === 'waiting') ui.result.textContent = `等待 ${result.missing.length} 位玩家投票：${result.missing.join(', ')}`;
    else if (result.tie) ui.result.textContent = `结果：平票（A ${result.counts.A} : B ${result.counts.B}）`;
    else ui.result.textContent = `结果：${result.winner} 阵营胜出（A ${result.counts.A} : B ${result.counts.B}）`;
    const canVote = state.role === 'player' && !state.game.votes[state.playerId];
    ui.voteA.disabled = !canVote;
    ui.voteB.disabled = !canVote;
  }

  function vote(choice) {
    if (state.role !== 'player' || !state.game || state.game.votes[state.playerId]) return;
    const event = createVoteEvent(state.playerId, choice, ++state.sequence);
    applyEvent(state.game, event);
    broadcast({ type: 'vote', event });
    log(`你投了 ${choice}`);
    renderGame();
  }

  ui.startHost.onclick = () => startHost().catch((error) => setStatus(error.message, 'error'));
  ui.joinRoom.onclick = () => joinAsPlayer().catch((error) => setStatus(error.message, 'error'));
  ui.voteA.onclick = () => vote('A');
  ui.voteB.onclick = () => vote('B');
  window.addEventListener('beforeunload', () => {
    stopSignaling().catch((error) => log(`关闭信令失败：${error.message}`));
  });
  ui.hostCard.hidden = false;
  ui.playerCard.hidden = false;
})();
