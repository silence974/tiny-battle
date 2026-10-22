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
  const PHASE_ORDER = ['exploration', 'production', 'purchase', 'action', 'combat', 'black', 'ended'];
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
      card.className = `roster-seat seat-color-p${seat}${player ? ' is-ready' : ''}`;
      card.dataset.seat = String(seat);
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
      row.className = `seat-link seat-color-p${link.seat}`;
      row.dataset.seat = String(link.seat);
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

  const RESOURCE_LABELS = { gold: '金币', wood: '木材', food: '食物' };
  const UNIT_LABELS = { militia: '民兵', guard: '卫兵' };

  function tileOwnerLabel(tile) {
    if (tile.owner === 'black') return '黑色势力';
    if (tile.owner) return tile.owner.toUpperCase();
    return '无人控制';
  }

  function tileBuildingLabel(tile) {
    return tile.building ? CARD_LABELS[tile.building] || tile.building : '无';
  }

  function tileForcesLabel(garrison = {}) {
    const forces = Object.entries(garrison).filter(([, count]) => count);
    return forces.length ? forces.map(([unit, count]) => `${UNIT_LABELS[unit] || unit} ${count}`).join(' / ') : '无';
  }

  function tileProductionLabel(production = {}) {
    const output = Object.entries(production).filter(([, amount]) => amount);
    return output.length ? output.map(([resource, amount]) => `${RESOURCE_LABELS[resource] || resource} ${amount}`).join(' / ') : '无产出';
  }

  function resourceCostLabel(cost = {}) {
    const values = Object.entries(cost).filter(([, amount]) => amount);
    return values.length ? values.map(([resource, amount]) => `${RESOURCE_LABELS[resource] || resource} ${amount}`).join('　') : '无';
  }

  function renderCardDetail(item, card) {
    const building = window.CONFIG_312?.buildings?.[card] || {};
    item.className = 'card-chip';
    const header = document.createElement('div');
    header.className = 'card-chip-header';
    const title = document.createElement('strong');
    title.textContent = CARD_LABELS[card] || card;
    header.append(title);
    if (building.points) {
      const points = document.createElement('strong');
      points.className = 'card-chip-points';
      points.textContent = String(building.points);
      header.append(points);
    }
    const production = document.createElement('div');
    production.className = 'card-chip-production';
    if (building.production) {
      production.append(...Object.entries({ 3: building.production.tier3, 2: building.production.tier2 }).map(([tier, amount], index) => {
        const row = document.createElement('div');
        row.className = 'production-tier';
        const axis = document.createElement('span');
        axis.className = 'tier-axis';
        axis.textContent = index === 0 ? 'Max' : '';
        const capacity = document.createElement('span');
        capacity.textContent = tier;
        const output = document.createElement('strong');
        output.textContent = `+${amount} ${RESOURCE_LABELS[building.production.resource] || building.production.resource}`;
        row.append(axis, capacity, output);
        return row;
      }));
    } else {
      const none = document.createElement('span');
      none.className = 'muted';
      none.textContent = '无产出';
      production.append(none);
    }
    const cost = document.createElement('div');
    cost.className = 'card-chip-cost';
    cost.textContent = `建造需求　${resourceCostLabel(building.build)}`;
    item.append(header, production, cost);
  }

  function renderTileVisual(cell, tile) {
    const ownerClass = tile.owner ? ` owner-${tile.owner.replace('_', '-')}` : '';
    cell.className = `${cell.className.split(' ').filter((name) => !name.startsWith('owner-') && !['unknown', 'black', 'black_hq', 'hq', 'land'].includes(name)).join(' ')} ${tile.explored ? tile.kind : 'unknown'}${ownerClass}`.trim();
    cell.replaceChildren();
    const owner = tileOwnerLabel(tile);
    const building = tileBuildingLabel(tile);
    const garrison = tile.garrison ? Object.values(tile.garrison).reduce((sum, count) => sum + (count || 0), 0) : 0;
    const expedition = tile.expeditions?.length ? `远征 ${tile.expeditions.length}` : '';
    const coord = document.createElement('span');
    coord.className = 'tile-coord';
    coord.textContent = tile.coord.join(',');
    const main = document.createElement('span');
    main.className = 'tile-main';
    main.textContent = tile.explored ? (tile.kind === 'black_hq' ? '黑总部' : owner) : '未知';
    const detail = document.createElement('span');
    detail.className = 'tile-detail';
    detail.textContent = building !== '无' ? building : (garrison ? `驻军 ${garrison}` : expedition);
    cell.append(coord, main, detail);
    return { building, garrison, expedition };
  }

  function closeTileDetail() {
    const inspector = $('tile-inspector');
    if (!inspector) return;
    inspector.hidden = true;
    delete inspector.dataset.coord;
  }

  function productionTierForTile(tile) {
    const building = window.CONFIG_312?.buildings?.[tile.building];
    const config = window.CONFIG_312;
    const capacity = tile.garrison
      ? Object.entries(tile.garrison).reduce((sum, [unit, count]) => sum + (count || 0) * (config.units[unit]?.capacity || 0), 0)
      : 0;
    if (tile.kind === 'hq' && tile.owner) {
      const tiers = (config.hqProductionTiers || []).map((tier, index) => ({
        id: `hq-${index}`,
        axis: index === 0 ? '0–5' : '6+',
        label: `容量 ${tier.minCapacity}–${tier.maxCapacity >= 999 ? '以上' : tier.maxCapacity}`,
        production: { gold: tier.gold || 0, wood: tier.wood || 0, food: tier.food || 0 },
        output: tileProductionLabel({ gold: tier.gold || 0, wood: tier.wood || 0, food: tier.food || 0 }),
      }));
      const active = (config.hqProductionTiers || []).findIndex((tier) => capacity >= tier.minCapacity && capacity <= tier.maxCapacity);
      return { capacity, activeTier: active >= 0 ? `hq-${active}` : 0, tiers };
    }
    if (!building?.production) return { capacity: 0, activeTier: 0, tiers: [] };
    const tiers = [
      {
        id: 3,
        axis: 'Max',
        label: '容量 3',
        production: { gold: building.production.resource === 'gold' ? building.production.tier3 : 0, wood: building.production.resource === 'wood' ? building.production.tier3 : 0, food: building.production.resource === 'food' ? building.production.tier3 : 0 },
        output: `+${building.production.tier3} ${RESOURCE_LABELS[building.production.resource] || building.production.resource}`,
      },
      {
        id: 2,
        axis: '',
        label: '容量 2',
        production: { gold: building.production.resource === 'gold' ? building.production.tier2 : 0, wood: building.production.resource === 'wood' ? building.production.tier2 : 0, food: building.production.resource === 'food' ? building.production.tier2 : 0 },
        output: `+${building.production.tier2} ${RESOURCE_LABELS[building.production.resource] || building.production.resource}`,
      },
    ];
    return { capacity, activeTier: capacity >= 3 ? 3 : capacity >= 2 ? 2 : 0, tiers };
  }

  function currentProductionForTile(tile, tierInfo = productionTierForTile(tile)) {
    if (!tile.explored || !tierInfo.activeTier) return { gold: 0, wood: 0, food: 0 };
    return tierInfo.tiers.find((tier) => tier.id === tierInfo.activeTier)?.production || { gold: 0, wood: 0, food: 0 };
  }

  function showTileDetail(tile) {
    const inspector = $('tile-inspector');
    if (!inspector) return;
    const coord = tile.coord.join(',');
    if (!inspector.hidden && inspector.dataset.coord === coord) {
      closeTileDetail();
      return;
    }
    inspector.dataset.coord = coord;
    $('tile-inspector-title').textContent = `地块 ${coord}`;
    const preview = $('tile-inspector-preview');
    preview.className = 'tile tile-inspector-preview';
    preview.setAttribute('aria-label', `地块 ${coord} 预览`);
    renderTileVisual(preview, tile);
    const building = window.CONFIG_312?.buildings?.[tile.building];
    const tierInfo = productionTierForTile(tile);
    const { capacity, activeTier, tiers } = tierInfo;
    const currentProduction = currentProductionForTile(tile, tierInfo);
    const rows = [
      ['类型', tile.explored ? (tile.kind === 'black_hq' ? '黑总部' : tile.kind) : '未知'],
      ['归属', tileOwnerLabel(tile)],
      ['建筑', tileBuildingLabel(tile)],
      ['驻军', tile.explored ? tileForcesLabel(tile.garrison) : '未知'],
      ['产出', tile.explored ? tileProductionLabel(currentProduction) : '未知'],
      ['控制', tile.explored ? (tile.controlled ? '已控制' : '未控制') : '未知'],
      ['黑方力量', tile.blackPower ? String(tile.blackPower) : '—'],
      ['远征队', tile.expeditions?.length ? String(tile.expeditions.length) : '无'],
    ];
    const copy = $('tile-inspector-copy');
    const summary = document.createElement('dl');
    summary.className = 'detail-list';
    summary.append(...rows.flatMap(([label, value]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const description = document.createElement('dd');
      description.textContent = value;
      return [term, description];
    }));
    const tierPanel = document.createElement('section');
    tierPanel.id = 'tile-inspector-tier';
    tierPanel.className = 'tile-inspector-section';
    const tierTitle = document.createElement('h3');
    tierTitle.textContent = '产能挡位';
    tierPanel.append(tierTitle);
    if (tiers.length && tile.explored) {
      tierPanel.append(...tiers.map((tier) => {
        const row = document.createElement('div');
        row.className = `production-tier${activeTier === tier.id ? ' is-active' : ''}`;
        row.dataset.tier = String(tier.id);
        const axis = document.createElement('span');
        axis.className = 'tier-axis';
        axis.textContent = tier.axis;
        const capacityLabel = document.createElement('span');
        capacityLabel.textContent = tier.label;
        const output = document.createElement('strong');
        output.textContent = tier.output;
        row.append(axis, capacityLabel, output);
        return row;
      }));
      const current = document.createElement('p');
      current.className = 'tile-inspector-current';
      current.textContent = activeTier ? `当前生效：${tiers.find((tier) => tier.id === activeTier)?.label || '已匹配'}（${tileProductionLabel(currentProduction)}）` : `当前生效：无产出（容量 ${capacity}）`;
      tierPanel.append(current);
    } else {
      const none = document.createElement('p');
      none.className = 'muted';
      none.textContent = '该建筑没有产能挡位';
      tierPanel.append(none);
    }
    const forcesPanel = document.createElement('section');
    forcesPanel.id = 'tile-inspector-forces';
    forcesPanel.className = 'tile-inspector-section';
    const forcesTitle = document.createElement('h3');
    forcesTitle.textContent = '当前驻军';
    forcesPanel.append(forcesTitle);
    if (tile.explored && tile.garrison) {
      const forceRows = Object.entries(tile.garrison).map(([unit, count]) => {
        const row = document.createElement('div');
        row.className = 'force-detail-row';
        const unitConfig = window.CONFIG_312.units[unit] || {};
        row.textContent = `${UNIT_LABELS[unit] || unit} · 战力 ${unitConfig.power ?? '—'} · 产能 ${unitConfig.capacity ?? '—'} · 数量 ${count}`;
        return row;
      });
      forcesPanel.append(...forceRows);
    } else {
      const none = document.createElement('p');
      none.className = 'muted';
      none.textContent = '未知';
      forcesPanel.append(none);
    }
    copy.replaceChildren(summary, tierPanel, forcesPanel);
    inspector.hidden = false;
  }

  function renderBoard(snapshot) {
    $('board').replaceChildren(...snapshot.board.map((tile) => {
      const cell = document.createElement('div');
      cell.className = 'tile';
      cell.tabIndex = 0;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-haspopup', 'dialog');
      const owner = tileOwnerLabel(tile);
      const building = tileBuildingLabel(tile);
      const expedition = tile.expeditions?.length ? `远征 ${tile.expeditions.length}` : '';
      cell.setAttribute('aria-label', `${tile.coord.join(',')} ${tile.explored ? owner : '未知'} ${building} ${expedition}`.trim());
      renderTileVisual(cell, tile);
      cell.addEventListener('click', () => showTileDetail(tile));
      cell.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        showTileDetail(tile);
      });
      return cell;
    }));
  }

  function formatPhase(phase) { return PHASE_LABELS[phase] || phase || '—'; }
  function countForces(forces = {}) { return Object.values(forces).reduce((sum, count) => sum + (count || 0), 0); }

  function renderPhaseGuide(snapshot) {
    const currentIndex = PHASE_ORDER.indexOf(snapshot.phase);
    document.querySelectorAll('.phase-step[data-phase]').forEach((step) => {
      const index = PHASE_ORDER.indexOf(step.dataset.phase);
      step.classList.toggle('is-current', step.dataset.phase === snapshot.phase);
      step.classList.toggle('is-complete', index >= 0 && index < currentIndex);
    });
    const active = snapshot.players.find((player) => player.seat === snapshot.activeSeat);
    const activeLabel = active ? `P${active.seat} ${active.name}` : '玩家方';
    const actionCount = (snapshot.legalActions || []).length;
    const guidance = {
      exploration: '探索正在结算：查看地图与事件，完成后自动进入产出。',
      production: '资源正在结算：确认产出后进入购牌阶段。',
      purchase: `${activeLabel} 购牌中：可选 1 张明牌、1 张盲牌，或结束购牌。`,
      action: `${activeLabel} 行动中：先看资源与兵力，再选择建造、派遣、部署或结束行动。${actionCount ? `当前有 ${actionCount} 项可选。` : ''}`,
      combat: '战斗正在同时结算：冲突结果完成后进入黑方阶段。',
      black: '黑方正在行动：扩张与抽牌完成后进入下一轮探索。',
      ended: snapshot.outcome?.status === 'win' ? '玩家方已占领黑总部，共同胜利。' : '对局已结束，查看共同结果与个人排名。',
    };
    $('phase-guidance').textContent = guidance[snapshot.phase] || '等待下一阶段。';
  }

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
      renderCardDetail(item, card);
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

  function renderLogList(element, events, emptyMessage) {
    element.replaceChildren(...(events.length ? events : []).map((event) => {
      const item = document.createElement('li');
      const label = event.type || event.name || '对局事件';
      const detail = event.card ? CARD_LABELS[event.card] || event.card
        : event.phase ? `${formatPhase(event.phase)} · 第 ${event.round || 1} 轮`
          : event.target ? `目标 ${event.target.join(',')}`
            : event.winner ? `胜者 ${event.winner}`
              : event.reason || event.resource || '';
      item.textContent = detail ? `${label} · ${typeof detail === 'object' ? JSON.stringify(detail) : detail}` : label;
      return item;
    }));
    if (!events.length) {
      const empty = document.createElement('li');
      empty.className = 'muted';
      empty.textContent = emptyMessage;
      element.append(empty);
    }
  }

  function renderEventLog(events = []) {
    renderLogList($('event-log'), events, '等待第一条事件');
  }

  function renderHostLog(game) {
    if (!game || !$('host-log')) return;
    const events = [{ type: '当前阶段', phase: game.phase, round: game.round }, ...(game.events || []).slice(-19)];
    const result = Engine.outcome(game, window.CONFIG_312);
    if (result.status !== 'ongoing') {
      events.push({ type: result.status === 'win' ? '共同胜利' : '共同失败', reason: result.reason });
    }
    renderLogList($('host-log'), events, '等待对局开始');
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
    if (state.mode === 'host') {
      $('game-panel').hidden = true;
      renderHostLog(state.game);
      return;
    }
    $('game-panel').hidden = false;
    $('phase').textContent = formatPhase(snapshot.phase);
    $('round').textContent = snapshot.round;
    $('sequence').textContent = snapshot.seq;
    const active = snapshot.players.find((player) => player.seat === snapshot.activeSeat);
    $('current-player').textContent = active ? `P${active.seat} ${active.name}` : '—';
    renderPhaseGuide(snapshot);
    renderBoard(snapshot);
    const me = snapshot.players.find((player) => player.id === state.enginePlayerId) || snapshot.players[0];
    $('player-identity').textContent = me ? `P${me.seat} ${me.name}` : '玩家 —';
    $('player-overview').dataset.seat = me ? String(me.seat) : '';
    $('hand-panel').dataset.seat = me ? String(me.seat) : '';
    $('action-panel').dataset.seat = me ? String(me.seat) : '';
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

  function settleHostAutomatic() {
    while (state.game && !state.game.result && ['exploration', 'production', 'combat', 'black'].includes(state.game.phase)) {
      state.game = Engine.advance(state.game);
    }
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
      settleHostAutomatic();
      renderHostLog(state.game);
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

  function closeDebugChannel() {
    state.debugChannel?.close?.();
    state.debugChannel = null;
  }

  function clearRoomState() {
    state.hostId = null;
    state.clientId = null;
    state.enginePlayerId = null;
    state.room = null;
    state.roomState = null;
    state.game = null;
    state.snapshot = null;
    $('room-panel').hidden = true;
    $('game-panel').hidden = true;
    closeTileDetail();
    $('debug-link').href = 'debug.html';
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
      closeDebugChannel();
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
      settleHostAutomatic();
      $('room-panel').hidden = false;
      $('room-code').textContent = state.room;
      renderLinks(Room.createSeatLinks(state.roomState, baseUrl()));
      renderRoster([]);
      $('game-panel').hidden = true;
      $('debug-link').href = `debug.html#r=${state.room}&h=${encodeURIComponent(state.hostId)}`;
      sessionStorage.setItem('tiny-battle-312-host', JSON.stringify({ room: state.room, hostId: state.hostId }));
      openDebugChannel();
      setStatus('主机已创建，等待四个席位');
      renderHostLog(state.game);
    } catch (error) {
      await closeTransport();
      closeDebugChannel();
      clearRoomState();
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
      await closeTransport();
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
      await closeTransport();
      clearRoomState();
      $('player-seat').textContent = '自动入座失败，请重新打开有效的席位链接。';
      setStatus('自动入座失败，请检查链接、网络或 Supabase 配置', 'error');
      setError(error);
    }
  }

  function simulationActionsForSeat(seat) {
    const probe = JSON.parse(JSON.stringify(state.game));
    probe.activeSeat = seat;
    const player = probe.players.find((candidate) => candidate.seat === seat);
    return Engine.legalActions(probe, player.id, window.CONFIG_312);
  }

  function chooseSimulationAction(actions, phase, cycleMode) {
    if (phase === 'purchase') {
      return actions.find((action) => action.type === 'purchase_face_up' && ['farm', 'goldmine', 'lumber'].includes(action.card))
        || actions.find((action) => action.type === 'purchase_face_up')
        || actions.find((action) => action.type === 'purchase_blind')
        || actions.find((action) => action.type === 'pass_purchase');
    }
    if (cycleMode === 'pass') return actions.find((action) => action.type === 'pass');
    return actions.find((action) => action.type === 'build' && ['farm', 'goldmine', 'lumber'].includes(action.building))
      || actions.find((action) => action.type === 'build')
      || actions.find((action) => action.type === 'dispatch')
      || actions.find((action) => action.type === 'deploy')
      || actions.find((action) => action.type === 'recruit')
      || actions.find((action) => action.type === 'pass');
  }

  function runQuickSimulation() {
    let steps = 0;
    let actionCycleMode = null;
    const counts = {};
    while (!state.game.result && steps < 512) {
      if (state.game.phase === 'purchase') {
        actionCycleMode = null;
        const player = state.game.players.find((candidate) => candidate.seat === state.game.activeSeat);
        const actions = Engine.legalActions(state.game, player.id, window.CONFIG_312);
        const action = chooseSimulationAction(actions, state.game.phase, actionCycleMode);
        if (!action) throw new Error('快速模拟无法继续：购牌阶段没有可用行动');
        counts[action.type] = (counts[action.type] || 0) + 1;
        state.game = Engine.applyCommand(state.game, { seq: state.game.seq, playerId: player.id, action }).state;
      } else if (state.game.phase === 'action') {
        if (state.game.activeSeat === 1 && state.game.players.every((player) => !player.passed)) {
          const available = state.game.players.map((player) => simulationActionsForSeat(player.seat).filter((action) => action.type !== 'pass'));
          actionCycleMode = available.every((actions) => actions.length > 0) ? 'play' : 'pass';
        }
        const player = state.game.players.find((candidate) => candidate.seat === state.game.activeSeat);
        const actions = Engine.legalActions(state.game, player.id, window.CONFIG_312);
        const action = chooseSimulationAction(actions, state.game.phase, actionCycleMode);
        if (!action) throw new Error(`快速模拟无法继续：行动阶段 P${player.seat} 没有可用行动`);
        counts[action.type] = (counts[action.type] || 0) + 1;
        state.game = Engine.applyCommand(state.game, { seq: state.game.seq, playerId: player.id, action }).state;
      } else {
        state.game = Engine.advance(state.game);
        settleAutomatic();
        if (state.game.phase !== 'action') actionCycleMode = null;
      }
      steps += 1;
    }
    if (!state.game.result) throw new Error('快速模拟超过安全步数，未能结束');
    return { steps, counts };
  }

  async function startQuickSimulation() {
    setError(null);
    setEntryBusy(true);
    try {
      readPlayerCount();
      closeDebugChannel();
      await closeTransport();
      state.mode = 'simulation';
      state.hostId = null;
      state.clientId = id();
      state.enginePlayerId = 'p1';
      state.room = null;
      state.roomState = null;
      state.game = Engine.createGame({ seed: 312, players: [1, 2, 3, 4].map((seat) => ({ id: `p${seat}`, name: `P${seat}`, seat })), config: window.CONFIG_312 });
      $('room-panel').hidden = true;
      const { steps, counts } = runQuickSimulation();
      const activity = ['purchase_face_up', 'purchase_blind', 'build', 'dispatch', 'deploy', 'recruit']
        .filter((type) => counts[type])
        .map((type) => `${ACTION_LABELS[type]} ${counts[type]}`)
        .join(' · ');
      setStatus(`快速模拟完成：${state.game.result.status === 'win' ? '玩家方胜利' : '玩家方失败'}（${steps} 步${activity ? `；${activity}` : ''}）`);
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
          settleHostAutomatic();
          renderHostLog(state.game);
          await broadcastState();
        } catch (error) { state.debugChannel.postMessage({ type: 'debug_error', message: error.message }); }
      }
    };
  }

  $('create-room').addEventListener('click', startHost);
  $('quick-simulate').addEventListener('click', startQuickSimulation);
  $('close-tile-inspector').addEventListener('click', closeTileDetail);
  document.addEventListener('click', (event) => {
    const inspector = $('tile-inspector');
    if (!inspector || inspector.hidden || inspector.contains(event.target) || event.target.closest('.tile')) return;
    closeTileDetail();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTileDetail();
  });
  window.addEventListener('pagehide', () => {
    if (state.mode === 'player' && state.transport) state.transport.leave();
  });
  showMode(state.mode);
  if (state.mode === 'player') void startPlayer();
})();
