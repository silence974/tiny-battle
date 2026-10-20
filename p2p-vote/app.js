/* global VoteGame */

(() => {
  const {
    createState,
    createVoteEvent,
    applyEvent,
    mergeEvents,
    settle,
    encodePayload,
    decodePayload,
  } = window.VoteGame;

  const NO_PUBLIC_SERVERS = { iceServers: [] };
  const PLAYER_COUNT = 4;
  const $ = (id) => document.getElementById(id);
  const ui = {
    role: $('role'),
    room: $('room'),
    status: $('status'),
    hostPanel: $('host-panel'),
    playerPanel: $('player-panel'),
    gamePanel: $('game-panel'),
    inviteList: $('invite-list'),
    answerInput: $('answer-input'),
    answerLink: $('answer-link'),
    answerBox: $('answer-box'),
    playerName: $('player-name'),
    playerInvite: $('player-invite'),
    roster: $('roster'),
    topology: $('topology'),
    eventLog: $('event-log'),
    result: $('result'),
    voteA: $('vote-a'),
    voteB: $('vote-b'),
  };

  const localKey = 'mesh-vote-player-id';
  const state = {
    role: null,
    room: null,
    hostId: null,
    playerId: null,
    playerName: '',
    seat: null,
    hostPeers: new Map(),
    peers: new Map(),
    players: new Map(),
    game: null,
    sequence: 0,
    invites: [],
    meshStarted: false,
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
    const line = document.createElement('div');
    line.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
    ui.eventLog.prepend(line);
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

  function makeLink(kind, payload) {
    return `${location.origin}${location.pathname}#${kind}=${encodePayload(payload)}`;
  }

  function decodeTextOrUrl(raw) {
    const text = raw.trim();
    const marker = text.includes('#') ? text.slice(text.indexOf('#') + 1) : text;
    const [kind, encoded] = marker.split('=', 2);
    if (!encoded || !['join', 'answer'].includes(kind)) throw new Error('不是有效的邀请或回答链接');
    return { kind, payload: decodePayload(encoded) };
  }

  function send(entry, message) {
    if (!entry || !entry.channel || entry.channel.readyState !== 'open') return false;
    entry.channel.send(JSON.stringify(message));
    return true;
  }

  function attachChannel(entry, channel) {
    entry.channel = channel;
    channel.onopen = () => {
      log(`${entry.kind === 'host' ? '主机' : '玩家'}连接已打开${entry.peerId ? `：${entry.peerId}` : ''}`);
      if (state.role === 'player' && entry.kind === 'host') {
        send(entry, {
          type: 'hello',
          playerId: state.playerId,
          name: state.playerName,
          seat: state.seat,
        });
      }
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

  function createPeerConnection(entry) {
    const pc = new RTCPeerConnection(NO_PUBLIC_SERVERS);
    entry.pc = pc;
    pc.onconnectionstatechange = () => {
      if (['failed', 'disconnected'].includes(pc.connectionState)) {
        log(`连接状态：${pc.connectionState}`);
      }
      renderTopology();
    };
    return pc;
  }

  async function createHostInvite(seat) {
    const entry = { kind: 'host', seat, peerId: `seat-${seat}`, pc: null, channel: null };
    const pc = createPeerConnection(entry);
    attachChannel(entry, pc.createDataChannel('control'));
    state.hostPeers.set(seat, entry);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceComplete(pc);
    const payload = {
      version: 1,
      room: state.room,
      hostId: state.hostId,
      seat,
      offer: pc.localDescription,
    };
    return { seat, url: makeLink('join', payload) };
  }

  async function startHost() {
    state.role = 'host';
    state.room = roomCode();
    state.hostId = randomId('host');
    ui.role.textContent = '主机（非投票席）';
    ui.room.textContent = state.room;
    ui.hostPanel.hidden = false;
    ui.playerPanel.hidden = true;
    setStatus('正在为 4 个席位生成邀请…');
    state.invites = [];
    for (let seat = 1; seat <= PLAYER_COUNT; seat += 1) {
      state.invites.push(await createHostInvite(seat));
    }
    renderInvites();
    setStatus('邀请已生成：分别发给四位玩家，等待他们回传 answer 链接。', 'ready');
    renderTopology();
  }

  function renderInvites() {
    ui.inviteList.replaceChildren();
    for (const invite of state.invites) {
      const row = document.createElement('div');
      row.className = 'invite-row';
      row.innerHTML = `<strong>玩家 ${invite.seat}</strong><textarea readonly></textarea><button>复制邀请</button>`;
      const text = row.querySelector('textarea');
      text.value = invite.url;
      row.querySelector('button').onclick = () => copyText(invite.url);
      ui.inviteList.append(row);
    }
  }

  async function importAnswer(raw) {
    const { kind, payload } = decodeTextOrUrl(raw);
    if (kind !== 'answer' || payload.room !== state.room) throw new Error('answer 不属于当前房间');
    const entry = state.hostPeers.get(Number(payload.seat));
    if (!entry) throw new Error('找不到对应席位');
    entry.peerId = payload.playerId;
    entry.name = payload.name;
    await entry.pc.setRemoteDescription(payload.answer);
    state.peers.set(payload.playerId, entry);
    log(`已导入玩家 ${payload.seat} 的 answer，等待连接打开。`);
    ui.answerInput.value = '';
  }

  async function joinFromInput(raw) {
    const { kind, payload } = decodeTextOrUrl(raw);
    if (kind !== 'join') throw new Error('这里需要主机邀请链接');
    state.role = 'player';
    state.room = payload.room;
    state.hostId = payload.hostId;
    state.seat = Number(payload.seat);
    state.playerId = localPlayerId();
    state.playerName = ui.playerName.value.trim() || `玩家${state.seat}`;
    ui.role.textContent = `玩家 ${state.seat}`;
    ui.room.textContent = state.room;
    ui.hostPanel.hidden = true;
    ui.playerPanel.hidden = false;
    const entry = { kind: 'host', peerId: 'host', pc: null, channel: null };
    const pc = createPeerConnection(entry);
    pc.ondatachannel = ({ channel }) => attachChannel(entry, channel);
    state.peers.set('host', entry);
    await pc.setRemoteDescription(payload.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceComplete(pc);
    const answerPayload = {
      version: 1,
      room: state.room,
      hostId: state.hostId,
      seat: state.seat,
      playerId: state.playerId,
      name: state.playerName,
      answer: pc.localDescription,
    };
    const link = makeLink('answer', answerPayload);
    ui.answerLink.value = link;
    ui.answerBox.hidden = false;
    setStatus('已生成 answer：复制回主机，等待连接建立。', 'ready');
  }

  function hostEntryForPlayer(playerId) {
    return [...state.hostPeers.values()].find((entry) => entry.peerId === playerId);
  }

  function sendToHost(message) {
    return send(state.peers.get('host'), message);
  }

  function sendToPlayer(playerId, message) {
    return send(hostEntryForPlayer(playerId), message);
  }

  function connectedPlayerIds() {
    return [...state.players.keys()].sort();
  }

  function registerPlayer(entry, message) {
    entry.peerId = message.playerId;
    entry.name = message.name;
    entry.seat = message.seat;
    state.peers.set(message.playerId, entry);
    state.players.set(message.playerId, {
      id: message.playerId,
      name: message.name,
      seat: message.seat,
    });
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
    for (const [from, to] of pairs) {
      sendToPlayer(from, { type: 'mesh-start', targetId: to });
    }
    log(`四席已齐，自动协商 ${pairs.length} 条玩家直连。`);
  }

  function playerEntry(peerId, kind = 'mesh') {
    return state.peers.get(peerId) || { kind, peerId, pc: null, channel: null };
  }

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
    sendToHost({
      type: 'mesh-signal',
      from: state.playerId,
      to: targetId,
      description: pc.localDescription,
    });
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
      sendToHost({
        type: 'mesh-signal',
        from: state.playerId,
        to: targetId,
        description: entry.pc.localDescription,
      });
    } else if (message.description.type === 'answer' && entry) {
      await entry.pc.setRemoteDescription(message.description);
    }
    renderTopology();
  }

  function relayMeshSignal(message) {
    if (state.role !== 'host') return;
    sendToPlayer(message.to, {
      type: 'mesh-signal',
      from: message.from,
      description: message.description,
    });
  }

  function broadcast(message, exceptPeerId = null) {
    for (const [peerId, entry] of state.peers.entries()) {
      if (peerId !== exceptPeerId) send(entry, message);
    }
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
    if (message.type === 'vote') {
      receiveVote(message.event, entry.peerId);
    }
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
    const open = [...state.peers.values()].filter((entry) => entry.channel?.readyState === 'open').length;
    const total = state.role === 'host' ? state.hostPeers.size : state.peers.size;
    ui.topology.textContent = `直连 ${open}/${total} · 主机仅负责初始信令，中继完成后玩家可直接互通`;
  }

  function renderGame() {
    if (!state.game) return;
    const result = settle(state.game);
    renderRoster();
    if (result.status === 'waiting') {
      ui.result.textContent = `等待 ${result.missing.length} 位玩家投票：${result.missing.join(', ')}`;
    } else if (result.tie) {
      ui.result.textContent = `结果：平票（A ${result.counts.A} : B ${result.counts.B}）`;
    } else {
      ui.result.textContent = `结果：${result.winner} 阵营胜出（A ${result.counts.A} : B ${result.counts.B}）`;
    }
    const canVote = state.role === 'player' && !state.game.votes[state.playerId];
    ui.voteA.disabled = !canVote;
    ui.voteB.disabled = !canVote;
    ui.gamePanel.hidden = false;
  }

  function vote(choice) {
    if (state.role !== 'player' || !state.game || state.game.votes[state.playerId]) return;
    const event = createVoteEvent(state.playerId, choice, ++state.sequence);
    applyEvent(state.game, event);
    broadcast({ type: 'vote', event });
    log(`你投了 ${choice}`);
    renderGame();
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const input = document.createElement('textarea');
      input.value = text;
      document.body.append(input);
      input.select();
      document.execCommand('copy');
      input.remove();
    }
    setStatus('已复制到剪贴板。', 'ready');
  }

  $('start-host').onclick = () => startHost().catch((error) => setStatus(error.message, 'error'));
  $('join-game').onclick = () => joinFromInput(ui.playerInvite.value).catch((error) => setStatus(error.message, 'error'));
  $('import-answer').onclick = () => importAnswer(ui.answerInput.value).then(() => setStatus('answer 已导入。', 'ready')).catch((error) => setStatus(error.message, 'error'));
  $('copy-answer').onclick = () => copyText(ui.answerLink.value).catch((error) => setStatus(error.message, 'error'));
  ui.voteA.onclick = () => vote('A');
  ui.voteB.onclick = () => vote('B');

  const hash = location.hash;
  if (hash.startsWith('#join=') || hash.startsWith('#answer=')) {
    ui.playerInvite.value = location.href;
    if (hash.startsWith('#join=')) setStatus('检测到邀请链接：填写昵称后点击加入。');
  }
})();
