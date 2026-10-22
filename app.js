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

  function hasSeatLinkMarker(url = location.href) {
    const parsed = new URL(url);
    if (['r', 's', 't'].some((key) => parsed.searchParams.has(key))) return true;
    return /(?:^|&)r=|(?:^|&)s=|(?:^|&)t=/.test(String(parsed.hash || '').replace(/^#/, ''));
  }

  const state = {
    // A damaged/copied seat link must fail in player mode, never silently create a second host.
    mode: hasSeatInvite() || hasSeatLinkMarker() ? 'player' : 'host',
    hostId: null,
    clientId: null,
    enginePlayerId: null,
    room: null,
    roomState: null,
    game: null,
    started: false,
    snapshot: null,
    hand: [],
    handPage: 0,
    selectedPurchaseSlot: null,
    lastActiveSeat: null,
    audioContext: null,
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
  const HAND_PAGE_SIZE = 4;

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
  function unlockTurnAudio() {
    if (state.audioContext) {
      if (state.audioContext.state === 'suspended') void state.audioContext.resume().catch(() => {});
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      state.audioContext = new AudioContext();
      if (state.audioContext.state === 'suspended') void state.audioContext.resume().catch(() => {});
    } catch {
      state.audioContext = null;
    }
  }
  function playTurnCue() {
    const context = state.audioContext;
    if (!context || context.state !== 'running') return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.exponentialRampToValueAtTime(660, now + .12);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.12, now + .01);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .14);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + .15);
  }
  function notifyTurn(snapshot, previousActiveSeat) {
    if (state.mode !== 'player' || previousActiveSeat === null || previousActiveSeat === snapshot.activeSeat) return;
    const me = snapshot.players.find((player) => player.id === state.enginePlayerId);
    if (me?.seat === snapshot.activeSeat) playTurnCue();
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
  const RESOURCE_SHORT_LABELS = { gold: '金', wood: '木', food: '食' };
  const UNIT_LABELS = { militia: '民兵', guard: '卫兵' };

  function tileOwnerLabel(tile) {
    if (tile.owner === 'black') return '黑色势力';
    if (tile.owner) return tile.owner.toUpperCase();
    return '无人控制';
  }

  function tileBuildingLabel(tile) {
    return tile.building ? cardDescription(tile.building).label : '无';
  }

  function tileForcesLabel(garrison = {}) {
    const forces = Object.entries(garrison).filter(([, count]) => count);
    return forces.length ? forces.map(([unit, count]) => `${UNIT_LABELS[unit] || unit} ${count}`).join(' / ') : '无';
  }

  function tileForcePower(garrison = {}, config = window.CONFIG_312) {
    return Object.entries(garrison || {}).reduce((sum, [unit, count]) => sum + (count || 0) * (config.units[unit]?.power || 0), 0);
  }

  function tileProductionLabel(production = {}) {
    const output = Object.entries(production).filter(([, amount]) => amount);
    return output.length ? output.map(([resource, amount]) => `+${amount}${RESOURCE_SHORT_LABELS[resource] || resource}`).join(' / ') : '无产出';
  }

  function tileProductionEffect(resource, amount) {
    return `+${amount}${RESOURCE_SHORT_LABELS[resource] || resource}`;
  }

  function resourceCostLabel(cost = {}) {
    const values = Object.entries(cost).filter(([, amount]) => amount);
    return values.length ? values.map(([resource, amount]) => `${RESOURCE_LABELS[resource] || resource} ${amount}`).join('　') : '无';
  }

  function cardFunctionalEffect(effect = {}) {
    return effect.label || '—';
  }

  function cardDescription(card) {
    const building = window.CONFIG_312?.buildings?.[card] || {};
    const source = building.description || {};
    const tierEffects = building.production
      ? {
        3: { type: 'resource', resource: building.production.resource, amount: building.production.tier3 },
        2: { type: 'resource', resource: building.production.resource, amount: building.production.tier2 },
      }
      : { 0: { type: 'functional', label: source.functional?.label || '—' } };
    const tiers = Object.entries(tierEffects)
      .sort(([left], [right]) => Number(right) - Number(left))
      .map(([capacity, effect]) => {
        return {
          capacity,
          effect: effect.type === 'resource'
            ? tileProductionEffect(effect.resource, effect.amount)
            : cardFunctionalEffect(effect),
        };
      });
    return {
      card,
      label: source.name || CARD_LABELS[card] || card,
      points: building.points || 0,
      tiers,
      cost: building.build || {},
    };
  }

  function renderCardProduction(container, description) {
    container.replaceChildren();
    const maxHeader = document.createElement('div');
    maxHeader.className = 'production-tier-header';
    maxHeader.textContent = 'Max';
    container.append(maxHeader, ...description.tiers.map((tier) => {
      const row = document.createElement('div');
      row.className = 'production-tier';
      const capacity = document.createElement('span');
      capacity.textContent = tier.capacity;
      const output = document.createElement('strong');
      output.textContent = tier.effect;
      row.append(capacity, output);
      return row;
    }));
  }

  function renderCardDetail(item, card) {
    const description = cardDescription(card);
    item.className = 'card-chip';
    const header = document.createElement('div');
    header.className = 'card-chip-header';
    const title = document.createElement('strong');
    title.textContent = description.label;
    header.append(title);
    const points = document.createElement('strong');
    points.className = 'card-chip-points';
    points.textContent = String(description.points);
    header.append(points);
    const production = document.createElement('div');
    production.className = 'card-chip-production';
    renderCardProduction(production, description);
    const cost = document.createElement('div');
    cost.className = 'card-chip-cost';
    cost.textContent = `建造需求　${resourceCostLabel(description.cost)}`;
    item.append(header, production, cost);
  }

  function renderTileVisual(cell, tile) {
    const ownerClass = tile.owner ? ` owner-${tile.owner.replace('_', '-')}` : '';
    cell.className = `${cell.className.split(' ').filter((name) => !name.startsWith('owner-') && !['unknown', 'black', 'black_hq', 'hq', 'land'].includes(name)).join(' ')} ${tile.explored ? tile.kind : 'unknown'}${ownerClass}`.trim();
    cell.replaceChildren();
    const building = tileBuildingLabel(tile);
    const garrisonPower = tile.blackPower !== null && tile.blackPower !== undefined
      ? tile.blackPower
      : tileForcePower(tile.garrison || {});
    const expedition = tile.expeditions?.length ? `远征 ${tile.expeditions.length}` : '';
    const main = document.createElement('span');
    main.className = 'tile-main';
    main.textContent = !tile.explored ? '未知'
      : building !== '无' ? building
        : tile.kind === 'black_hq' ? '黑总部'
          : tile.kind === 'hq' ? '总部'
            : tile.kind === 'black' ? '黑区' : '空地';
    const points = document.createElement('span');
    points.className = 'tile-points';
    points.textContent = String(tileInspectorPoints(tile));
    points.hidden = !tile.explored || (building === '无' && !['hq', 'black_hq'].includes(tile.kind));
    const garrisonBadge = document.createElement('span');
    garrisonBadge.className = 'tile-garrison';
    garrisonBadge.hidden = !tile.explored || garrisonPower <= 0;
    garrisonBadge.setAttribute('aria-label', `驻扎战力 ${garrisonPower}`);
    const garrisonIcon = document.createElement('span');
    garrisonIcon.className = 'tile-garrison-icon';
    garrisonIcon.setAttribute('aria-hidden', 'true');
    garrisonIcon.textContent = '⚔';
    const garrisonValue = document.createElement('span');
    garrisonValue.textContent = String(garrisonPower);
    garrisonBadge.append(garrisonIcon, garrisonValue);
    const detail = document.createElement('span');
    detail.className = 'tile-detail';
    detail.textContent = expedition;
    cell.append(main, points, garrisonBadge, detail);
    return { building, garrisonPower, expedition };
  }

  function closeTileDetail() {
    const inspector = $('tile-inspector');
    if (!inspector) return;
    inspector.hidden = true;
    delete inspector.dataset.coord;
    delete inspector.dataset.card;
    delete inspector.dataset.kind;
    const forcesPanel = $('tile-inspector-forces');
    if (forcesPanel) forcesPanel.hidden = false;
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
        axis: String(tier.minCapacity),
        label: '',
        production: { gold: tier.gold || 0, wood: tier.wood || 0, food: tier.food || 0 },
        output: tileProductionLabel({ gold: tier.gold || 0, wood: tier.wood || 0, food: tier.food || 0 }),
      }));
      const active = (config.hqProductionTiers || []).findIndex((tier) => capacity >= tier.minCapacity && capacity <= tier.maxCapacity);
      return { capacity, activeTier: active >= 0 ? `hq-${active}` : 0, tiers };
    }
    if (!building?.production) return { capacity: 0, activeTier: 0, tiers: [] };
    const description = cardDescription(tile.building);
    const effectFor = (capacity) => description.tiers.find((tier) => tier.capacity === String(capacity))?.effect
      || tileProductionEffect(building.production.resource, building.production[`tier${capacity}`]);
    const tiers = [
      {
        id: 3,
        axis: '3',
        label: '',
        production: { gold: building.production.resource === 'gold' ? building.production.tier3 : 0, wood: building.production.resource === 'wood' ? building.production.tier3 : 0, food: building.production.resource === 'food' ? building.production.tier3 : 0 },
        output: effectFor(3),
      },
      {
        id: 2,
        axis: '2',
        label: '',
        production: { gold: building.production.resource === 'gold' ? building.production.tier2 : 0, wood: building.production.resource === 'wood' ? building.production.tier2 : 0, food: building.production.resource === 'food' ? building.production.tier2 : 0 },
        output: effectFor(2),
      },
    ];
    return { capacity, activeTier: capacity >= 3 ? 3 : capacity >= 2 ? 2 : 0, tiers };
  }

  function currentProductionForTile(tile, tierInfo = productionTierForTile(tile)) {
    if (!tile.explored || !tierInfo.activeTier) return { gold: 0, wood: 0, food: 0 };
    return tierInfo.tiers.find((tier) => tier.id === tierInfo.activeTier)?.production || { gold: 0, wood: 0, food: 0 };
  }

  function tileInspectorTitle(tile) {
    if (tile.building) return cardDescription(tile.building).label;
    if (tile.kind === 'black_hq') return '黑色总部';
    if (tile.kind === 'hq') return '总部';
    return tile.explored ? tileOwnerLabel(tile) : '未知地块';
  }

  function tileInspectorPoints(tile) {
    if (tile.building) return cardDescription(tile.building).points;
    if (tile.kind === 'black_hq') return window.CONFIG_312?.black?.hqPoints || 0;
    return 0;
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
    inspector.dataset.kind = 'tile';
    delete inspector.dataset.card;
    inspector.setAttribute('aria-label', `${tileInspectorTitle(tile)} ${coord}`);
    $('tile-inspector-title').textContent = tileInspectorTitle(tile);
    const points = $('tile-inspector-points');
    const score = tileInspectorPoints(tile);
    points.textContent = String(score);
    points.hidden = false;
    const tierInfo = productionTierForTile(tile);
    const { activeTier, tiers } = tierInfo;
    const tierPanel = $('tile-inspector-tiers');
    tierPanel.replaceChildren();
    if (tiers.length && tile.explored) {
      const maxHeader = document.createElement('div');
      maxHeader.className = 'production-tier-header';
      maxHeader.textContent = 'Max';
      tierPanel.append(maxHeader, ...[...tiers].sort((left, right) => Number(right.axis) - Number(left.axis)).map((tier) => {
        const row = document.createElement('div');
        row.className = `production-tier${activeTier === tier.id ? ' is-active' : ''}`;
        row.dataset.tier = String(tier.id);
        const axis = document.createElement('span');
        axis.className = 'tier-axis';
        const output = document.createElement('strong');
        output.textContent = tier.output;
        axis.textContent = tier.axis;
        row.append(axis, output);
        return row;
      }));
    } else {
      const none = document.createElement('p');
      none.className = 'muted';
      none.textContent = '该建筑没有产能挡位';
      tierPanel.append(none);
    }
    const cost = $('tile-inspector-cost');
    const description = tile.building ? cardDescription(tile.building) : null;
    cost.textContent = `建造要求　${resourceCostLabel(description?.cost)}`;
    const forcesPanel = $('tile-inspector-forces');
    forcesPanel.hidden = false;
    forcesPanel.replaceChildren();
    if (tile.explored && tile.garrison) {
      const forceRows = Object.entries(tile.garrison).map(([unit, count]) => {
        const row = document.createElement('div');
        row.className = 'force-detail-row';
        const unitConfig = window.CONFIG_312.units[unit] || {};
        const description = document.createElement('span');
        description.textContent = `${UNIT_LABELS[unit] || unit}｜战力 ${unitConfig.power ?? '—'}｜产能 ${unitConfig.capacity ?? '—'}`;
        const quantity = document.createElement('strong');
        quantity.textContent = String(count);
        row.append(description, quantity);
        return row;
      });
      forcesPanel.append(...forceRows);
    } else {
      const none = document.createElement('p');
      none.className = 'muted';
      none.textContent = tile.explored ? '无驻军' : '未知';
      forcesPanel.append(none);
    }
    inspector.hidden = false;
  }

  function showCardDetail(card) {
    const inspector = $('tile-inspector');
    if (!inspector) return;
    if (!inspector.hidden && inspector.dataset.kind === 'card' && inspector.dataset.card === card) {
      closeTileDetail();
      return;
    }
    const description = cardDescription(card);
    inspector.dataset.kind = 'card';
    inspector.dataset.card = card;
    delete inspector.dataset.coord;
    inspector.setAttribute('aria-label', `${description.label} 卡牌详情`);
    $('tile-inspector-title').textContent = description.label;
    const points = $('tile-inspector-points');
    points.textContent = String(description.points);
    points.hidden = false;
    renderCardProduction($('tile-inspector-tiers'), description);
    $('tile-inspector-cost').textContent = `建造要求　${resourceCostLabel(description.cost)}`;
    $('tile-inspector-forces').hidden = true;
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
    for (const resource of ['gold', 'wood', 'food']) {
      const node = $(`resource-${resource}`);
      if (node) node.textContent = resources[resource] ?? 0;
    }
    const resourceSummary = $('resources');
    if (resourceSummary) resourceSummary.textContent = JSON.stringify(resources);
    const ap = $('ap-value');
    if (ap) ap.textContent = player?.ap ?? 0;
  }

  function renderGameSessionMeta(player) {
    const meta = $('game-session-meta');
    if (!meta) return;
    $('game-room-code').textContent = state.mode === 'simulation' ? 'LOCAL' : state.room || '—';
    $('player-identity').textContent = player ? `P${player.seat} ${player.name}` : '玩家 —';
    meta.hidden = false;
  }

  function renderPlayerRoster(players = [], activeSeat, round, result) {
    const bySeat = new Map(players.map((player) => [player.seat, player]));
    const ended = result && result.status !== 'ongoing';
    const rankingByPlayer = new Map((result?.ranking || []).map((entry) => [entry.playerId, entry]));
    $('turn-order').textContent = ended
      ? `终局 · ${result.status === 'win' ? '共同胜利' : '共同失败'}`
      : `第 ${round ?? '—'} 轮 · ${activeSeat ? `P${activeSeat} 行动` : '等待行动'}`;
    const orderedSeats = [1, 2, 3, 4];
    $('player-roster-list').replaceChildren(...orderedSeats.map((seat, orderIndex) => {
      const player = bySeat.get(seat);
      const card = document.createElement('article');
      const activeClass = ended ? '' : (player && player.seat === activeSeat ? ' is-active' : '');
      card.className = `player-roster-card seat-color-p${seat}${activeClass}`;
      card.dataset.seat = String(seat);
      const heading = document.createElement('div');
      heading.className = 'player-roster-heading';
      const order = document.createElement('span');
      order.className = 'player-order-index';
      order.textContent = String(orderIndex + 1).padStart(2, '0');
      const identity = document.createElement('strong');
      identity.textContent = player ? `P${seat} ${player.name}` : `P${seat}`;
      const status = document.createElement('span');
      status.className = 'player-roster-status';
      const rankingEntry = player && rankingByPlayer.get(player.id);
      status.textContent = ended
        ? (rankingEntry ? `第${rankingEntry.rank}名` : '已结束')
        : (player ? (player.seat === activeSeat ? '当前行动' : '已入座') : '等待加入');
      const identityWrap = document.createElement('span');
      identityWrap.className = 'player-roster-identity';
      identityWrap.append(order, identity);
      heading.append(identityWrap, status);
      const metrics = document.createElement('div');
      metrics.className = 'player-roster-metrics';
      const resources = player ? player.resources || {} : {};
      for (const [label, resource] of [['G', 'gold'], ['W', 'wood'], ['F', 'food']]) {
        const value = document.createElement('span');
        value.textContent = `${label} ${resources[resource] ?? '—'}`;
        metrics.append(value);
      }
      const score = document.createElement('strong');
      score.className = 'player-roster-score';
      score.textContent = `${player ? player.score ?? '—' : '—'} 分`;
      metrics.append(score);
      card.append(heading, metrics);
      return card;
    }));
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

  function renderHandPage(hand = state.hand) {
    state.hand = hand;
    const pageCount = Math.max(1, Math.ceil(hand.length / HAND_PAGE_SIZE));
    state.handPage = Math.min(Math.max(state.handPage, 0), pageCount - 1);
    const start = state.handPage * HAND_PAGE_SIZE;
    const visibleHand = hand.slice(start, start + HAND_PAGE_SIZE);
    $('hand-pager').hidden = pageCount <= 1;
    $('hand-page-label').textContent = `${state.handPage + 1} / ${pageCount}`;
    $('hand-page-prev').disabled = state.handPage === 0;
    $('hand-page-next').disabled = state.handPage >= pageCount - 1;
    $('hand').replaceChildren(...(visibleHand.length ? visibleHand : []).map((card) => {
      const item = document.createElement('div');
      const description = cardDescription(card);
      renderCardDetail(item, card);
      item.classList.add('card-chip-interactive');
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-haspopup', 'dialog');
      item.setAttribute('aria-label', `${description.label} 卡牌详情`);
      item.addEventListener('click', () => showCardDetail(card));
      item.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        showCardDetail(card);
      });
      return item;
    }));
    if (!visibleHand.length) {
      const empty = document.createElement('span');
      empty.className = 'muted';
      empty.textContent = '暂无手牌';
      $('hand').append(empty);
    }
  }

  function renderHand(hand = []) {
    state.handPage = 0;
    $('hand-count').textContent = hand.length;
    renderHandPage(hand);
  }

  function renderPurchaseActions(actions = []) {
    const panel = $('purchase-actions');
    if (!panel) return;
    const snapshot = state.snapshot;
    const isPurchase = snapshot?.phase === 'purchase';
    panel.hidden = !isPurchase;
    if (!isPurchase) {
      state.selectedPurchaseSlot = null;
      return;
    }
    const market = $('purchase-market');
    const faceUpActions = new Map(actions.filter((action) => action.type === 'purchase_face_up').map((action) => [action.card, action]));
    const faceUpCards = snapshot.market?.faceUp || [];
    const currentSelectedCard = Number.isInteger(state.selectedPurchaseSlot) ? faceUpCards[state.selectedPurchaseSlot] : null;
    if (!currentSelectedCard || !faceUpActions.has(currentSelectedCard)) state.selectedPurchaseSlot = null;
    const purchaseHandlers = window.PurchaseUI312.createPurchaseCommandHandlers({
      actions,
      faceUpCards,
      faceUpActions,
      getSelectedSlot: () => state.selectedPurchaseSlot,
      setSelectedSlot: (slot) => {
        state.selectedPurchaseSlot = slot;
        renderPurchaseActions(actions);
      },
      clearSelection: () => {
        state.selectedPurchaseSlot = null;
        renderPurchaseActions(actions);
      },
      submitAction,
    });
    market.replaceChildren(...faceUpCards.map((card, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `card-chip purchase-market-card${state.selectedPurchaseSlot === index ? ' is-selected' : ''}`;
      item.dataset.purchaseSlot = String(index);
      item.dataset.purchaseCard = card;
      item.disabled = !faceUpActions.has(card);
      item.setAttribute('aria-pressed', String(state.selectedPurchaseSlot === index));
      item.setAttribute('aria-label', `${cardDescription(card).label}，${item.disabled ? '当前不可购买' : '选择后确认购买'}`);
      renderCardDetail(item, card);
      item.classList.add('purchase-market-card');
      item.addEventListener('click', () => purchaseHandlers.selectSlot(index));
      return item;
    }));
    const selectedCardIndex = state.selectedPurchaseSlot;
    const selectedCard = Number.isInteger(selectedCardIndex) ? faceUpCards[selectedCardIndex] : null;
    const selectedDescription = selectedCard ? cardDescription(selectedCard) : null;
    $('purchase-selection-status').textContent = selectedDescription
      ? `已选：${selectedDescription.label}，点击“购买所选”确认`
      : '请选择一张明牌';
    const confirm = $('purchase-confirm');
    confirm.disabled = !selectedCard || !faceUpActions.has(selectedCard);
    confirm.onclick = () => void purchaseHandlers.confirm();
    const random = $('purchase-random');
    random.disabled = !actions.some((action) => action.type === 'purchase_blind');
    random.onclick = () => void purchaseHandlers.random();
    const pass = $('purchase-pass');
    pass.disabled = !actions.some((action) => action.type === 'pass_purchase');
    pass.onclick = () => void purchaseHandlers.pass();
  }

  function renderActions(actions) {
    renderPurchaseActions(actions);
    const actionsPanel = $('legal-actions');
    const currentPhase = state.snapshot?.phase || document.querySelector('.phase-step.is-current')?.dataset.phase;
    if (currentPhase === 'purchase') {
      actionsPanel.replaceChildren();
      return;
    }
    const host = currentPhase
      ? document.querySelector(`.phase-step[data-phase="${currentPhase}"] .phase-step-actions`)
      : null;
    if (host && actionsPanel && host !== actionsPanel && actionsPanel.parentElement !== host) host.append(actionsPanel);
    actionsPanel.replaceChildren(...actions.map((action) => {
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
      actionsPanel.append(empty);
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
    if (!state.started) {
      const joined = state.roomState?.players.size || 0;
      renderLogList($('host-log'), [{ type: '等待四席入座', reason: `${joined}/${Room.PLAYER_COUNT}` }], '等待四席入座');
      return;
    }
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
    const previousActiveSeat = state.lastActiveSeat;
    state.snapshot = snapshot;
    state.lastActiveSeat = snapshot.activeSeat;
    notifyTurn(snapshot, previousActiveSeat);
    if (state.mode === 'host') {
      document.body.classList.remove('is-game-active');
      $('game-session-meta').hidden = true;
      $('entry').hidden = false;
      $('game-panel').hidden = true;
      renderHostLog(state.game);
      return;
    }
    document.body.classList.add('is-game-active');
    if (!document.body.dataset.mobilePanel) document.body.dataset.mobilePanel = 'board';
    $('entry').hidden = true;
    $('room-panel').hidden = true;
    $('game-panel').hidden = false;
    $('phase').textContent = formatPhase(snapshot.phase);
    $('round').textContent = snapshot.round;
    $('sequence').textContent = snapshot.seq;
    const active = snapshot.players.find((player) => player.seat === snapshot.activeSeat);
    const ended = snapshot.outcome?.status && snapshot.outcome.status !== 'ongoing';
    $('current-player-label').textContent = ended ? '终局结果' : '当前行动';
    $('current-player').textContent = ended
      ? (snapshot.outcome.status === 'win' ? '共同胜利' : '共同失败')
      : (active ? `P${active.seat} ${active.name}` : '—');
    renderPlayerRoster(snapshot.players, snapshot.activeSeat, snapshot.round, snapshot.outcome);
    renderPhaseGuide(snapshot);
    renderBoard(snapshot);
    const me = snapshot.players.find((player) => player.id === state.enginePlayerId) || snapshot.players[0];
    renderGameSessionMeta(me);
    $('hand-panel').dataset.seat = me ? String(me.seat) : '';
    renderResourceStrip(me);
    renderHand(me?.hand || []);
    renderActions(snapshot.legalActions || []);
    renderEventLog(snapshot.eventLog || []);
    renderOutcome(snapshot.outcome);
    setConnectionState('connected', state.mode === 'host' ? '主机在线' : state.mode === 'simulation' ? '本地模拟' : '已连接');
  }

  function setMobilePanel(panel) {
    document.body.dataset.mobilePanel = panel;
    document.querySelectorAll('.mobile-game-tabs [data-mobile-target]').forEach((button) => {
      button.classList.toggle('is-selected', button.dataset.mobileTarget === panel);
    });
  }

  async function sendEnvelope(envelope) { return state.transport.send(envelope); }

  async function broadcastState(target = null, requestId = undefined) {
    if (!state.started) return;
    const targets = target ? [target] : [...state.roomState.players.keys()];
    for (const playerId of targets) {
      const player = state.roomState.players.get(playerId);
      await sendEnvelope(Room.makeEnvelope({
        room: state.room,
        type: 'state',
        from: state.hostId,
        to: playerId,
        requestId: target && playerId === target ? requestId : undefined,
        seq: state.game.seq,
        payload: { snapshot: Engine.snapshot(state.game, player?.engineId || playerId) },
      }));
    }
    publishDebug();
  }

  async function sendRoster(target = null) {
    renderRoster([...state.roomState.players.values()].map(({ id, name, seat }) => ({ id, name, seat })));
    renderHostLog(state.game);
    await sendEnvelope(Room.makeEnvelope({
      room: state.room,
      type: 'roster',
      from: state.hostId,
      to: target,
      payload: { players: [...state.roomState.players.values()].map(({ id, name, seat }) => ({ id, name, seat })) },
    }));
  }

  async function sendWaiting(target, requestId) {
    await sendEnvelope(Room.makeEnvelope({
      room: state.room,
      type: 'waiting',
      from: state.hostId,
      to: target,
      requestId,
      payload: { joined: state.roomState.players.size, required: Room.PLAYER_COUNT, started: false },
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

  function startGameAfterAllSeats() {
    if (state.started || !state.roomState || state.roomState.players.size !== Room.PLAYER_COUNT) return false;
    state.started = true;
    settleHostAutomatic();
    renderHostLog(state.game);
    setStatus('四席已入座，对局开始');
    return true;
  }

  async function acceptPlayerCommand(message) {
    const player = state.roomState.players.get(message.from);
    if (!player) return;
    if (!state.started) {
      await sendEnvelope(Room.makeEnvelope({ room: state.room, type: 'reject', from: state.hostId, to: message.from, requestId: message.requestId, payload: { reason: 'waiting-for-seats' } }));
      return;
    }
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
      await broadcastState();
      await broadcastState(message.from, message.requestId);
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
    const startedNow = startGameAfterAllSeats();
    if (!state.started) {
      await sendWaiting(message.from, message.requestId);
      publishDebug();
      return;
    }
    if (startedNow) {
      await sendRoster();
      await broadcastState();
      await broadcastState(message.from, message.requestId);
    } else {
      await broadcastState(message.from, message.requestId);
    }
    publishDebug();
  }

  async function onResync(message) {
    if (!state.roomState.players.has(message.from)) {
      await sendEnvelope(Room.makeEnvelope({ room: state.room, type: 'reject', from: state.hostId, to: message.from, requestId: message.requestId, payload: { reason: 'seat-not-ready' } }));
      return;
    }
    await sendRoster(message.from);
    if (!state.started) {
      await sendWaiting(message.from, message.requestId);
      return;
    }
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
    state.started = false;
    state.snapshot = null;
    state.lastActiveSeat = null;
    state.selectedPurchaseSlot = null;
    $('entry').hidden = false;
    $('room-panel').hidden = true;
    $('game-panel').hidden = true;
    document.body.classList.remove('is-game-active');
    $('game-session-meta').hidden = true;
    document.body.dataset.mobilePanel = 'board';
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
      state.started = false;
      state.lastActiveSeat = null;
      state.selectedPurchaseSlot = null;
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
      showMode('player');
      state.snapshot = null;
      state.game = null;
      state.started = false;
      state.lastActiveSeat = null;
      state.selectedPurchaseSlot = null;
      $('game-panel').hidden = true;
      $('game-session-meta').hidden = true;
      document.body.classList.remove('is-game-active');
      await closeTransport();
      const seat = readSeatLink();
      $('player-seat').textContent = `正在自动加入 P${seat.seat}（${seat.name}）…`;
      state.room = seat.room;
      state.enginePlayerId = Room.enginePlayerId(seat.seat);
      state.clientId = `${seat.room}-seat-${seat.seat}-${persistentSeatIdentity(seat.room, seat.seat)}`;
      $('room-panel').hidden = false;
      $('room-code').textContent = state.room;
      state.transport = Room.createRoomTransport({
        config,
        handlers: {
          roster: (message) => renderRoster(message.payload?.players || []),
          state: (message) => renderSnapshot(message.payload?.snapshot),
          reject: (message) => setError(message.payload?.reason || '请求被主机拒绝'),
        },
      });
      await state.transport.join({ room: seat.room, seat: seat.seat, token: seat.token, clientId: state.clientId, name: seat.name });
      $('player-seat').textContent = `已自动加入 P${seat.seat}（${seat.name}）`;
      if (!state.snapshot) {
        setStatus(`已连接到 P${seat.seat}，等待主机状态`);
      } else {
        setStatus(`已连接到 P${seat.seat}`);
      }
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

  function runQuickSimulation({ maxSteps = 512 } = {}) {
    let steps = 0;
    let actionCycleMode = null;
    const counts = {};
    while (!state.game.result && steps < maxSteps) {
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
    if (!state.game.result && maxSteps >= 512) throw new Error('快速模拟超过安全步数，未能结束');
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
      state.started = true;
      state.hostId = null;
      state.clientId = id();
      state.enginePlayerId = 'p1';
      state.lastActiveSeat = null;
      state.selectedPurchaseSlot = null;
      state.room = null;
      state.roomState = null;
      state.game = Engine.createGame({ seed: 312, players: [1, 2, 3, 4].map((seat) => ({ id: `p${seat}`, name: `P${seat}`, seat })), config: window.CONFIG_312 });
      $('room-panel').hidden = true;
      const previewMode = new URLSearchParams(location.search).get('preview') === 'ongoing';
      const { steps, counts } = runQuickSimulation({ maxSteps: previewMode ? 42 : 512 });
      const activity = ['purchase_face_up', 'purchase_blind', 'build', 'dispatch', 'deploy', 'recruit']
        .filter((type) => counts[type])
        .map((type) => `${ACTION_LABELS[type]} ${counts[type]}`)
        .join(' · ');
      if (previewMode) {
        state.enginePlayerId = state.game.players.find((player) => player.seat === state.game.activeSeat)?.id || state.enginePlayerId;
      }
      const status = previewMode
        ? `进行中预览：第 ${state.game.round} 轮 · ${formatPhase(state.game.phase)}`
        : `快速模拟完成：${state.game.result.status === 'win' ? '玩家方胜利' : '玩家方失败'}`;
      setStatus(`${status}（${steps} 步${activity ? `；${activity}` : ''}）`);
      renderSnapshot(Engine.snapshot(state.game, state.enginePlayerId));
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
  $('hand-page-prev').addEventListener('click', () => {
    state.handPage -= 1;
    renderHandPage();
  });
  $('hand-page-next').addEventListener('click', () => {
    state.handPage += 1;
    renderHandPage();
  });
  document.querySelectorAll('.mobile-game-tabs [data-mobile-target]').forEach((button) => {
    button.addEventListener('click', () => setMobilePanel(button.dataset.mobileTarget));
  });
  document.addEventListener('click', (event) => {
    const inspector = $('tile-inspector');
    if (!inspector || inspector.hidden || event.target === inspector) {
      if (inspector && !inspector.hidden && event.target === inspector) closeTileDetail();
      return;
    }
    if (inspector.contains(event.target) || event.target.closest('.tile') || event.target.closest('.card-chip-interactive')) return;
    closeTileDetail();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeTileDetail();
  });
  document.addEventListener('pointerdown', unlockTurnAudio, { passive: true });
  document.addEventListener('keydown', unlockTurnAudio);
  window.addEventListener('pagehide', () => {
    if (state.mode === 'player' && state.transport) state.transport.leave();
  });
  window.addEventListener('hashchange', () => {
    if (hasSeatInvite() || hasSeatLinkMarker()) void startPlayer();
  });
  showMode(state.mode);
  setMobilePanel('board');
  if (state.mode === 'player') void startPlayer();
})();
