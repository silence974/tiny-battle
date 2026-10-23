(function bootApp() {
  const Engine = window.Engine312;
  const Room = window.Room312;
  const PhaseNotices = window.PhaseNotices312;
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
    lastPhase: null,
    phaseBannerTimer: null,
    phaseNoticeCounter: 0,
    phaseNoticeSeen: new Set(),
    phaseNoticeQueue: [],
    phaseNoticePlaying: false,
    phaseNotices: [],
    collapsedPhases: new Set(),
    actionMode: null,
    buildDraft: null,
    buildDrag: null,
    dispatchDraft: null,
    recruitDraft: null,
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
  const PHASE_DISPLAY_MS = 1200;
  const ACTION_LABELS = {
    pass: '跳过',
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
  function playPhaseCue() {
    const context = state.audioContext;
    if (!context || context.state !== 'running') return;
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'triangle';
    oscillator.frequency.setValueAtTime(520, now);
    oscillator.frequency.exponentialRampToValueAtTime(780, now + .16);
    gain.gain.setValueAtTime(.0001, now);
    gain.gain.exponentialRampToValueAtTime(.1, now + .015);
    gain.gain.exponentialRampToValueAtTime(.0001, now + .2);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + .21);
  }
  function nextPhaseNoticeId() {
    const sequence = state.game?.seq ?? state.snapshot?.seq ?? 'local';
    const id = `${sequence}:${state.phaseNoticeCounter}`;
    state.phaseNoticeCounter += 1;
    return id;
  }
  function makePhaseNotice(phase, initial = false) {
    return { id: nextPhaseNoticeId(), kind: 'phase', phase, initial };
  }
  function productionOutputNotices(after) {
    const viewerId = after.players[0]?.id;
    const snapshot = Engine.snapshot(after, viewerId, window.CONFIG_312);
    return snapshot.board
      .filter((tile) => tile.owner?.startsWith('p') && (tile.kind === 'hq' || tile.building))
      .filter((tile) => Object.values(tile.production || {}).some((amount) => amount > 0))
      .map((tile) => {
        const player = after.players.find((candidate) => candidate.id === tile.owner);
        return {
          id: nextPhaseNoticeId(),
          kind: 'production',
          phase: 'production',
          seat: player?.seat || null,
          label: tile.kind === 'hq' ? '总部' : cardDescription(tile.building).label,
          output: productionNoticeOutput(tile.production),
        };
      });
  }
  function noticesForAdvance(before, after) {
    const notices = [];
    if (before.phase === 'production' && after.phase === 'purchase') notices.push(...productionOutputNotices(after));
    if (before.phase !== after.phase) notices.push(makePhaseNotice(after.phase));
    return notices;
  }
  function renderPhaseTransition(notice) {
    const banner = $('phase-transition-banner');
    if (!banner) return;
    const label = $('phase-transition-label');
    const detail = $('phase-transition-detail');
    const phaseNumber = PHASE_ORDER.indexOf(notice.phase) + 1;
    const details = {
      exploration: '发现地图与事件',
      production: '结算总部与建筑资源',
      purchase: '选择明牌、盲牌，或结束购牌',
      action: '建设、派遣、部署与招募',
      combat: '同时结算战斗结果',
      black: '黑色势力扩张与行动',
      ended: state.snapshot?.outcome?.status === 'win' ? '共同胜利' : '共同结果与排名',
    };
    const isProduction = notice.kind === 'production';
    label.textContent = isProduction
      ? `${String(phaseNumber).padStart(2, '0')} / 产出`
      : `${String(phaseNumber).padStart(2, '0')} / ${formatPhase(notice.phase)}`;
    detail.textContent = isProduction
      ? `P${notice.seat || '—'} · ${notice.label}｜${notice.output}`
      : details[notice.phase] || '阶段同步';
    banner.hidden = false;
    banner.dataset.phase = isProduction ? 'production-output' : notice.phase;
    banner.classList.remove('is-visible');
    void banner.offsetWidth;
    banner.classList.add('is-visible');
    if (!isProduction && !notice.initial) playPhaseCue();
  }
  function playNextPhaseNotice() {
    if (state.phaseNoticePlaying) return;
    const notice = state.phaseNoticeQueue.shift();
    if (!notice) {
      state.phaseNoticePlaying = false;
      if (state.snapshot) renderActions(state.snapshot.legalActions || []);
      return;
    }
    state.phaseNoticePlaying = true;
    renderPhaseTransition(notice);
    if (state.phaseBannerTimer) clearTimeout(state.phaseBannerTimer);
    const duration = notice.kind === 'production' ? 700 : PHASE_DISPLAY_MS;
    state.phaseBannerTimer = setTimeout(() => {
      const banner = $('phase-transition-banner');
      if (banner) {
        banner.classList.remove('is-visible');
        banner.hidden = true;
      }
      state.phaseNoticePlaying = false;
      playNextPhaseNotice();
    }, duration);
  }
  function enqueuePhaseNotices(snapshot, notices) {
    const fresh = (notices || []).filter((notice) => notice?.id && !state.phaseNoticeSeen.has(notice.id));
    if (!fresh.length) return;
    fresh.forEach((notice) => state.phaseNoticeSeen.add(notice.id));
    state.phaseNoticeQueue.push(...fresh);
    playNextPhaseNotice();
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

  function productionNoticeOutput(production = {}) {
    const output = Object.entries(production).filter(([, amount]) => amount);
    return output.length ? output.map(([resource, amount]) => `+${amount} ${RESOURCE_SHORT_LABELS[resource] || resource}`).join(' / ') : '无产出';
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
    forcesPanel.replaceChildren();
    const forceEntries = Object.entries(tile.garrison || {}).filter(([, count]) => Number(count) > 0);
    if (!tile.explored || !forceEntries.length) {
      forcesPanel.hidden = true;
    } else {
      forcesPanel.hidden = false;
      const forceRows = forceEntries.map(([unit, count]) => {
        const row = document.createElement('div');
        row.className = 'force-detail-row';
        const line = document.createElement('div');
        line.className = 'force-detail-line';
        const unitConfig = window.CONFIG_312.units[unit] || {};
        const copy = document.createElement('div');
        copy.className = 'force-detail-copy';
        const unitLabel = document.createElement('span');
        unitLabel.className = 'force-detail-unit';
        unitLabel.textContent = UNIT_LABELS[unit] || unit;
        const meta = document.createElement('span');
        meta.className = 'force-detail-meta';
        for (const [label, value] of [['战力', unitConfig.power ?? '—'], ['产能', unitConfig.capacity ?? '—']]) {
          const stat = document.createElement('span');
          stat.className = 'force-detail-stat';
          stat.textContent = `${label} ${value}`;
          meta.append(stat);
        }
        copy.append(unitLabel, meta);
        const quantity = document.createElement('strong');
        quantity.className = 'force-detail-quantity';
        quantity.setAttribute('aria-label', `${UNIT_LABELS[unit] || unit}人数 ${count}`);
        quantity.textContent = `${count}人`;
        if (state.actionMode === 'dispatch' && dispatchCanTake(tile.coord)) {
          const controls = document.createElement('span');
          controls.className = 'force-detail-controls';
          const minus = document.createElement('button');
          minus.type = 'button';
          minus.className = 'force-detail-adjust';
          minus.textContent = '−';
          const selectedCount = state.dispatchDraft?.allocations?.[coordKey(tile.coord)]?.[unit] || 0;
          minus.disabled = selectedCount <= 0;
          minus.setAttribute('aria-label', `减少${UNIT_LABELS[unit] || unit}`);
          minus.onclick = () => changeDispatchForce(tile.coord, unit, -1);
          const plus = document.createElement('button');
          plus.type = 'button';
          plus.className = 'force-detail-adjust';
          plus.textContent = '+';
          plus.disabled = selectedCount >= (tile.garrison?.[unit] || 0);
          plus.setAttribute('aria-label', `增加${UNIT_LABELS[unit] || unit}`);
          plus.onclick = () => changeDispatchForce(tile.coord, unit, 1);
          controls.append(minus, plus);
          row.append(copy, quantity);
          line.append(row, controls);
        } else {
          row.append(copy, quantity);
          line.append(row);
        }
        return line;
      });
      forcesPanel.append(...forceRows);
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

  function buildActions(actions = state.snapshot?.legalActions || []) {
    return actions.filter((action) => action.type === 'build' && Array.isArray(action.at));
  }

  function coordKey(coord) {
    return Array.isArray(coord) ? coord.join(',') : String(coord || '');
  }

  function buildActionFor(actions, building, at) {
    return buildActions(actions).find((action) => action.building === building && coordKey(action.at) === coordKey(at)) || null;
  }

  function buildTargetActions(actions) {
    const targets = new Map();
    for (const action of buildActions(actions)) {
      const key = coordKey(action.at);
      if (!targets.has(key)) targets.set(key, []);
      targets.get(key).push(action);
    }
    return targets;
  }

  function clearBuildDraft({ refresh = true } = {}) {
    state.buildDraft = null;
    if (state.buildDrag?.ghost) state.buildDrag.ghost.remove();
    state.buildDrag = null;
    if (refresh && state.snapshot) {
      renderBoard(state.snapshot);
      renderHandPage(state.hand);
    }
  }

  function buildCanAct() {
    const snapshot = state.snapshot;
    const me = snapshot?.players?.find((player) => player.id === state.enginePlayerId) || snapshot?.players?.[0];
    return snapshot?.phase === 'action'
      && me?.seat === snapshot.activeSeat
      && !state.phaseNoticePlaying
      && state.phaseNoticeQueue.length === 0;
  }

  function renderBuildSurface(actions = state.snapshot?.legalActions || []) {
    if (!state.snapshot) return;
    renderBoard(state.snapshot);
    renderHandPage(state.hand);
    renderActions(actions);
  }

  function chooseBuildTarget(coord, actions = state.snapshot?.legalActions || []) {
    if (!buildCanAct()) return false;
    const targetActions = buildTargetActions(actions).get(coordKey(coord));
    if (!targetActions?.length) return false;
    const existing = state.buildDraft;
    const building = existing?.at && coordKey(existing.at) === coordKey(coord) ? existing.building : null;
    const cardIndex = building ? existing.cardIndex : null;
    state.buildDraft = { building, cardIndex, at: [...coord], action: building ? buildActionFor(actions, building, coord) : null };
    renderBuildSurface(actions);
    return true;
  }

  function chooseBuildCard(card, cardIndex, actions = state.snapshot?.legalActions || []) {
    if (!buildCanAct() || state.actionMode !== 'build' || !state.buildDraft?.at) return false;
    const action = buildActionFor(actions, card, state.buildDraft.at);
    if (!action) return false;
    state.buildDraft = { building: card, cardIndex, at: [...state.buildDraft.at], action };
    renderBuildSurface(actions);
    return true;
  }

  function createBuildDragGhost(card) {
    const ghost = document.createElement('div');
    ghost.className = 'build-drag-ghost';
    ghost.textContent = cardDescription(card).label;
    document.body.append(ghost);
    return ghost;
  }

  function buildTileAtPoint(event) {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    return element?.closest?.('.tile') || null;
  }

  function updateBuildDrag(event) {
    const drag = state.buildDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.ghost) {
      drag.ghost.style.left = `${event.clientX + 12}px`;
      drag.ghost.style.top = `${event.clientY + 12}px`;
    }
    document.querySelectorAll('.tile.is-build-drag-over').forEach((tile) => tile.classList.remove('is-build-drag-over'));
    const tile = buildTileAtPoint(event);
    if (tile && buildTargetActions(state.snapshot?.legalActions || []).has(tile.dataset.coord)) {
      tile.classList.add('is-build-drag-over');
    }
  }

  function finishBuildDrag(event, cancelled = false) {
    const drag = state.buildDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const tile = cancelled ? null : buildTileAtPoint(event);
    const coord = tile?.dataset.coord?.split(',').map(Number);
    if (drag.ghost) drag.ghost.remove();
    state.buildDrag = null;
    document.querySelectorAll('.tile.is-build-drag-over').forEach((node) => node.classList.remove('is-build-drag-over'));
    if (coord && buildTargetActions(state.snapshot?.legalActions || []).has(coordKey(coord))) {
      state.buildDraft = {
        building: drag.card,
        cardIndex: drag.cardIndex,
        at: coord,
        action: buildActionFor(state.snapshot?.legalActions || [], drag.card, coord),
      };
    }
    if (state.snapshot) renderBuildSurface(state.snapshot.legalActions || []);
  }

  async function submitBuildDraft(actions = state.snapshot?.legalActions || []) {
    const draft = state.buildDraft;
    const action = draft?.building && draft?.at ? buildActionFor(actions, draft.building, draft.at) : null;
    if (!action) {
      clearBuildDraft();
      return;
    }
    state.buildDraft = { building: draft.building, cardIndex: draft.cardIndex, at: [...draft.at], action };
    const accepted = await submitAction(action);
    clearBuildDraft();
    if (!accepted && state.snapshot) renderBuildSurface(state.snapshot.legalActions || []);
  }

  function dispatchActions(actions = state.snapshot?.legalActions || []) {
    return actions.filter((action) => action.type === 'dispatch' && Array.isArray(action.from));
  }

  function dispatchStartActions(actions) {
    const starts = new Map();
    for (const action of dispatchActions(actions)) {
      const key = coordKey(action.from);
      if (!starts.has(key)) starts.set(key, action);
    }
    return starts;
  }

  function adjacentCoord(a, b) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
  }

  function dispatchRouteCoords(draft) {
    return draft ? [draft.from, ...(draft.route || [])] : [];
  }

  function dispatchNextCoords(draft) {
    if (!draft || draft.endLocked) return [];
    const last = draft.route?.length ? draft.route[draft.route.length - 1] : draft.from;
    const used = new Set(dispatchRouteCoords(draft).map(coordKey));
    return (state.snapshot?.board || [])
      .filter((tile) => adjacentCoord(last, tile.coord) && !used.has(coordKey(tile.coord)))
      .map((tile) => tile.coord);
  }

  function dispatchSourceTile(coord) {
    return state.snapshot?.board?.find((tile) => coordKey(tile.coord) === coordKey(coord)) || null;
  }

  function dispatchCanTake(coord) {
    const route = dispatchRouteCoords(state.dispatchDraft);
    return route.slice(0, -1).some((candidate) => coordKey(candidate) === coordKey(coord));
  }

  function dispatchTotals(allocations = {}) {
    const totals = { militia: 0, guard: 0 };
    for (const forces of Object.values(allocations)) {
      totals.militia += forces.militia || 0;
      totals.guard += forces.guard || 0;
    }
    return totals;
  }

  function dispatchPower(forces) {
    const units = window.CONFIG_312?.units || {};
    return Object.entries(forces || {}).reduce((sum, [unit, count]) => sum + (units[unit]?.power || 0) * count, 0);
  }

  function dispatchCapacity(forces) {
    const units = window.CONFIG_312?.units || {};
    return Object.entries(forces || {}).reduce((sum, [unit, count]) => sum + (units[unit]?.capacity || 0) * count, 0);
  }

  function updateDispatchAction() {
    const draft = state.dispatchDraft;
    if (!draft) return;
    const forces = dispatchTotals(draft.allocations);
    draft.forces = forces;
    draft.action = draft.route?.length ? {
      ...draft.baseAction,
      from: [...draft.from],
      to: [...draft.route[draft.route.length - 1]],
      route: draft.route.map((coord) => [...coord]),
      forces,
      routeForces: Object.entries(draft.allocations)
        .filter(([, allocation]) => (allocation.militia || 0) + (allocation.guard || 0) > 0)
        .map(([at, allocation]) => ({ at: at.split(',').map(Number), forces: { ...allocation } })),
    } : null;
  }

  function chooseDispatchStart(coord, actions = state.snapshot?.legalActions || []) {
    if (!buildCanAct()) return false;
    const baseAction = dispatchStartActions(actions).get(coordKey(coord));
    if (!baseAction) return false;
    state.dispatchDraft = {
      from: [...coord],
      route: [],
      baseAction,
      allocations: {},
      forces: { militia: 0, guard: 0 },
      action: null,
      endLocked: false,
    };
    renderDispatchSurface(actions);
    return true;
  }

  function handleDispatchTile(tile) {
    const actions = state.snapshot?.legalActions || [];
    if (!state.dispatchDraft) {
      chooseDispatchStart(tile.coord, actions);
      return true;
    }
    const draft = state.dispatchDraft;
    const coord = tile.coord;
    const fullRoute = dispatchRouteCoords(draft);
    const inRoute = fullRoute.some((candidate) => coordKey(candidate) === coordKey(coord));
    if (inRoute) {
      if (!draft.endLocked && draft.route.length && coordKey(draft.route[draft.route.length - 1]) === coordKey(coord)) {
        draft.endLocked = true;
        updateDispatchAction();
        renderDispatchSurface(actions);
        return true;
      }
      if (coordKey(coord) === coordKey(draft.from) || draft.endLocked || coordKey(coord) !== coordKey(draft.route[draft.route.length - 1])) {
        showTileDetail(tile);
        return true;
      }
    }
    if (!draft.endLocked && dispatchNextCoords(draft).some((candidate) => coordKey(candidate) === coordKey(coord))) {
      draft.route.push([...coord]);
      if (tile.owner !== state.enginePlayerId || !tile.explored || !tile.controlled) draft.endLocked = true;
      updateDispatchAction();
      renderDispatchSurface(actions);
      return true;
    }
    return true;
  }

  function changeDispatchForce(coord, unit, delta) {
    const draft = state.dispatchDraft;
    if (!draft || !dispatchCanTake(coord)) return;
    const source = dispatchSourceTile(coord);
    if (!source) return;
    const current = draft.allocations[coordKey(coord)] || { militia: 0, guard: 0 };
    const next = Math.max(0, Math.min(source.garrison?.[unit] || 0, (current[unit] || 0) + delta));
    if (delta < 0 && source.kind === 'hq') {
      const afterSelected = (current.militia || 0) - (unit === 'militia' ? next : (current.militia || 0))
        + (current.guard || 0) - (unit === 'guard' ? next : (current.guard || 0));
      const remaining = (source.garrison.militia || 0) + (source.garrison.guard || 0) - afterSelected;
      if (remaining <= 0) return;
    }
    current[unit] = next;
    if (!current.militia && !current.guard) delete draft.allocations[coordKey(coord)];
    else draft.allocations[coordKey(coord)] = current;
    updateDispatchAction();
    renderDispatchSurface(state.snapshot?.legalActions || []);
    showTileDetail(source);
  }

  function clearDispatchDraft({ refresh = true } = {}) {
    state.dispatchDraft = null;
    closeTileDetail();
    if (refresh && state.snapshot) renderDispatchSurface(state.snapshot.legalActions || []);
  }

  function clearActionSelection({ refresh = true } = {}) {
    state.actionMode = null;
    clearBuildDraft({ refresh: false });
    clearDispatchDraft({ refresh: false });
    state.recruitDraft = null;
    if (refresh && state.snapshot) {
      renderBoard(state.snapshot);
      renderHandPage(state.hand);
      renderActions(state.snapshot.legalActions || []);
    }
  }

  function renderDispatchSummary(container, canAct) {
    const draft = state.dispatchDraft;
    if (!draft) return;
    const summary = document.createElement('div');
    summary.className = 'dispatch-summary';
    summary.setAttribute('aria-label', '已选择派遣兵力');
    const totals = dispatchTotals(draft.allocations);
    for (const unit of ['militia', 'guard']) {
      const row = document.createElement('div');
      row.className = 'dispatch-summary-row';
      row.textContent = `${UNIT_LABELS[unit]} ${totals[unit] || 0}`;
      summary.append(row);
    }
    const stats = document.createElement('strong');
    stats.textContent = `战力 ${dispatchPower(totals)}　产能 ${dispatchCapacity(totals)}`;
    summary.append(stats);
    container.append(summary);
  }

  function renderDispatchSurface(actions = state.snapshot?.legalActions || []) {
    if (!state.snapshot) return;
    renderBoard(state.snapshot);
    renderActions(actions);
  }

  async function submitDispatchDraft(actions = state.snapshot?.legalActions || []) {
    const draft = state.dispatchDraft;
    if (!draft?.endLocked || !draft.action) {
      clearDispatchDraft();
      return;
    }
    const path = dispatchRouteCoords(draft).map((coord) => [...coord]);
    const accepted = await submitAction(draft.action);
    clearDispatchDraft();
    if (accepted) {
      document.querySelectorAll('.tile').forEach((tile) => {
        if (path.some((coord) => coordKey(coord) === tile.dataset.coord)) tile.classList.add('is-dispatch-moving');
      });
      window.setTimeout(() => document.querySelectorAll('.tile.is-dispatch-moving').forEach((tile) => tile.classList.remove('is-dispatch-moving')), 420);
    } else if (state.snapshot) renderDispatchSurface(state.snapshot.legalActions || actions);
  }

  function renderRecruitPanel(container, actions, canAct) {
    const recruitActions = actions.filter((action) => action.type === 'recruit');
    if (!recruitActions.length) return;
    const panel = document.createElement('div');
    panel.className = 'recruit-panel';
    panel.setAttribute('aria-label', '招募行动');
    panel.setAttribute('role', 'table');
    const units = [...new Set(recruitActions.map((action) => action.unit))];
    const selected = state.recruitDraft?.unit;
    const header = document.createElement('div');
    header.className = 'recruit-header';
    header.setAttribute('role', 'row');
    for (const [key, label] of [['unit', '单位'], ['power', '战力'], ['capacity', '产能'], ['cost', '单兵花费']]) {
      const cell = document.createElement('span');
      cell.className = `recruit-cell recruit-cell-${key}`;
      cell.setAttribute('role', 'columnheader');
      cell.textContent = label;
      header.append(cell);
    }
    panel.append(header);
    for (const unit of units) {
      const row = document.createElement('div');
      row.className = `recruit-row${selected === unit ? ' is-selected' : ''}`;
      row.setAttribute('role', 'row');
      row.tabIndex = canAct ? 0 : -1;
      row.setAttribute('aria-selected', String(selected === unit));
      const unitConfig = window.CONFIG_312.units[unit] || {};
      row.setAttribute('aria-label', `${UNIT_LABELS[unit] || unit}，战力 ${unitConfig.power ?? '—'}，产能 ${unitConfig.capacity ?? '—'}，${resourceCostLabel(unitConfig.recruit)}`);
      for (const [key, text] of [
        ['unit', UNIT_LABELS[unit] || unit],
        ['power', unitConfig.power ?? '—'],
        ['capacity', unitConfig.capacity ?? '—'],
        ['cost', resourceCostLabel(unitConfig.recruit)],
      ]) {
        const cell = document.createElement('span');
        cell.className = `recruit-cell recruit-cell-${key}`;
        cell.setAttribute('role', 'cell');
        cell.textContent = String(text);
        row.append(cell);
      }
      const select = () => {
        if (!canAct) return;
        state.recruitDraft = { unit, count: Math.min(state.recruitDraft?.count || 1, 3), action: null };
        renderActions(actions);
      };
      row.addEventListener('click', select);
      row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        select();
      });
      panel.append(row);
    }
    if (selected) {
      const count = state.recruitDraft.count || 1;
      const selectedConfig = window.CONFIG_312.units[selected] || {};
      const totalCost = Object.fromEntries(Object.entries(selectedConfig.recruit || {}).map(([resource, amount]) => [resource, amount * count]));
      const controls = document.createElement('div');
      controls.className = 'recruit-controls';
      controls.setAttribute('aria-label', '招募数量与总消耗');
      const quantity = document.createElement('strong');
      quantity.className = 'recruit-quantity';
      quantity.textContent = `数量 ${count}`;
      const minus = document.createElement('button');
      minus.type = 'button';
      minus.textContent = '−';
      minus.disabled = !canAct || count <= 1;
      minus.onclick = () => { state.recruitDraft.count -= 1; renderActions(actions); };
      const plus = document.createElement('button');
      plus.type = 'button';
      plus.textContent = '+';
      plus.disabled = !canAct || count >= 3 || !recruitActions.some((action) => action.unit === selected && action.count === count + 1);
      plus.onclick = () => { state.recruitDraft.count += 1; renderActions(actions); };
      const total = document.createElement('span');
      total.className = 'recruit-total-cost';
      total.textContent = `总消耗 ${resourceCostLabel(totalCost)}`;
      controls.append(quantity, minus, plus, total);
      panel.append(controls);
      const confirmAction = recruitActions.find((action) => action.unit === selected && action.count === count);
      const confirm = document.createElement('button');
      confirm.type = 'button';
      confirm.id = 'recruit-confirm';
      confirm.className = 'primary-button';
      confirm.textContent = '确认招募';
      confirm.disabled = !canAct || !confirmAction;
      confirm.onclick = () => void submitAction(confirmAction);
      panel.append(confirm);
    }
    container.append(panel);
  }

  function renderBoard(snapshot) {
    const buildMode = state.actionMode === 'build' && snapshot.phase === 'action';
    const dispatchMode = state.actionMode === 'dispatch' && snapshot.phase === 'action';
    const targets = buildTargetActions(snapshot.legalActions || []);
    const dispatchStarts = dispatchStartActions(snapshot.legalActions || []);
    const dispatchRoute = dispatchRouteCoords(state.dispatchDraft);
    const dispatchNext = new Set(dispatchNextCoords(state.dispatchDraft).map(coordKey));
    $('board').replaceChildren(...snapshot.board.map((tile) => {
      const cell = document.createElement('div');
      cell.className = 'tile';
      cell.dataset.coord = coordKey(tile.coord);
      cell.tabIndex = 0;
      cell.setAttribute('role', 'button');
      cell.setAttribute('aria-haspopup', 'dialog');
      const owner = tileOwnerLabel(tile);
      const building = tileBuildingLabel(tile);
      const expedition = tile.expeditions?.length ? `远征 ${tile.expeditions.length}` : '';
      cell.setAttribute('aria-label', `${tile.coord.join(',')} ${tile.explored ? owner : '未知'} ${building} ${expedition}`.trim());
      renderTileVisual(cell, tile);
      const targetActions = targets.get(cell.dataset.coord) || [];
      const selected = state.buildDraft?.at && coordKey(state.buildDraft.at) === cell.dataset.coord;
      const dispatchEndpoint = dispatchMode && state.dispatchDraft?.endLocked
        && dispatchRoute.length > 0
        && coordKey(dispatchRoute[dispatchRoute.length - 1]) === cell.dataset.coord;
      cell.classList.toggle('is-build-target', buildMode && targetActions.length > 0);
      cell.classList.toggle('is-build-target-selected', buildMode && Boolean(selected));
      cell.classList.toggle('is-dispatch-start', dispatchMode && !state.dispatchDraft && dispatchStarts.has(cell.dataset.coord));
      cell.classList.toggle('is-dispatch-unavailable', dispatchMode && !state.dispatchDraft && !dispatchStarts.has(cell.dataset.coord));
      cell.classList.toggle('is-dispatch-route', dispatchMode && dispatchRoute.some((coord) => coordKey(coord) === cell.dataset.coord));
      cell.classList.toggle('is-dispatch-next', dispatchMode && Boolean(state.dispatchDraft) && dispatchNext.has(cell.dataset.coord));
      cell.classList.toggle('is-dispatch-battle', Boolean(dispatchEndpoint && !tile.explored));
      if (dispatchEndpoint && !tile.explored) {
        const battle = document.createElement('span');
        battle.className = 'tile-dispatch-battle';
        battle.textContent = '战斗';
        battle.setAttribute('aria-label', '战斗');
        cell.append(battle);
        cell.setAttribute('aria-label', `${cell.getAttribute('aria-label')} 战斗`);
      }
      if (buildMode && selected) {
        cell.classList.add('is-build-preview');
        const preview = document.createElement('span');
        preview.className = 'tile-build-preview';
        preview.textContent = state.buildDraft.building ? cardDescription(state.buildDraft.building).label : '建造';
        cell.append(preview);
      }
      const handleTile = () => {
        if (dispatchMode && handleDispatchTile(tile)) return;
        if (buildMode && chooseBuildTarget(tile.coord, snapshot.legalActions || [])) return;
        showTileDetail(tile);
      };
      cell.addEventListener('click', handleTile);
      cell.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handleTile();
      });
      return cell;
    }));
  }

  function formatPhase(phase) { return PHASE_LABELS[phase] || phase || '—'; }
  function countForces(forces = {}) { return Object.values(forces).reduce((sum, count) => sum + (count || 0), 0); }

  function isInteractivePhase(phase) {
    return phase === 'purchase' || phase === 'action';
  }

  function syncPhaseCollapse(phase) {
    const step = document.querySelector(`.phase-step[data-phase="${phase}"]`);
    if (!step) return;
    const toggle = step.querySelector('[data-phase-toggle]');
    if (!toggle) {
      step.classList.remove('is-collapsed');
      return;
    }
    const collapsed = state.collapsedPhases.has(phase);
    step.classList.toggle('is-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }

  function syncAllPhaseCollapse() {
    document.querySelectorAll('.phase-step[data-phase]').forEach((step) => syncPhaseCollapse(step.dataset.phase));
  }

  function bindPhaseToggleButtons() {
    document.querySelectorAll('[data-phase-toggle]').forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const phase = toggle.dataset.phaseToggle;
        if (!phase) return;
        if (state.collapsedPhases.has(phase)) state.collapsedPhases.delete(phase);
        else state.collapsedPhases.add(phase);
        syncPhaseCollapse(phase);
      });
    });
    syncAllPhaseCollapse();
  }

  function renderPhaseGuide(snapshot, previousPhase = state.lastPhase, previousActiveSeat = state.lastActiveSeat) {
    const currentIndex = PHASE_ORDER.indexOf(snapshot.phase);
    document.querySelectorAll('.phase-step[data-phase]').forEach((step) => {
      const index = PHASE_ORDER.indexOf(step.dataset.phase);
      step.classList.toggle('is-current', step.dataset.phase === snapshot.phase);
      step.classList.toggle('is-complete', index >= 0 && index < currentIndex);
    });
    const active = snapshot.players.find((player) => player.seat === snapshot.activeSeat);
    const activeLabel = active ? `P${active.seat} ${active.name}` : '玩家方';
    const actionCount = (snapshot.legalActions || []).length;
    const me = snapshot.players.find((player) => player.id === state.enginePlayerId) || snapshot.players[0];
    const isMyTurn = isInteractivePhase(snapshot.phase) && me?.seat === snapshot.activeSeat;
    const wasMyTurn = isInteractivePhase(previousPhase) && me?.seat === previousActiveSeat;
    const enteredPhase = previousPhase === null || previousPhase !== snapshot.phase;
    const becameMyTurn = !wasMyTurn && isMyTurn;
    if (enteredPhase || becameMyTurn) state.collapsedPhases.delete(snapshot.phase);
    syncAllPhaseCollapse();
    const guidance = {
      exploration: '探索正在结算：查看地图与事件，完成后自动进入产出。',
      production: '资源正在结算：确认产出后进入购牌阶段。',
      purchase: `${activeLabel} 购牌中：可选 1 张明牌、1 张盲牌，或结束购牌。`,
      action: `${activeLabel} 行动中：先看资源与兵力，再选择建造、派遣、部署或跳过。${actionCount ? `当前有 ${actionCount} 项可选。` : ''}`,
      combat: '战斗正在同时结算：冲突结果完成后进入黑方阶段。',
      black: '黑方正在行动：扩张与抽牌完成后进入下一轮探索。',
      ended: snapshot.outcome?.status === 'win' ? '玩家方已占领黑总部，共同胜利。' : '对局已结束，查看共同结果与个人排名。',
    };
    $('phase-guidance').textContent = becameMyTurn
      ? `${activeLabel}，轮到你，可以操作。${actionCount ? `当前有 ${actionCount} 项可选。` : ''}`
      : (guidance[snapshot.phase] || '等待下一阶段。');
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
    const buildMode = state.actionMode === 'build' && state.snapshot?.phase === 'action';
    const actions = state.snapshot?.legalActions || [];
    $('hand').replaceChildren(...(visibleHand.length ? visibleHand : []).map((card, visibleIndex) => {
      const cardIndex = start + visibleIndex;
      const item = buildMode ? document.createElement('button') : document.createElement('div');
      const description = cardDescription(card);
      renderCardDetail(item, card);
      item.classList.add('card-chip-interactive');
      if (buildMode) {
        item.type = 'button';
        item.classList.add('is-build-card');
        const selectedBuildCard = state.buildDraft?.cardIndex === cardIndex;
        const available = Boolean(state.buildDraft?.at && buildActionFor(actions, card, state.buildDraft.at))
          || buildActions(actions).some((action) => action.building === card);
        item.disabled = !available || !buildCanAct();
        item.setAttribute('aria-disabled', String(item.disabled));
        item.setAttribute('aria-pressed', String(selectedBuildCard));
        item.classList.toggle('is-build-card-selected', selectedBuildCard);
        item.classList.toggle('is-build-card-disabled', item.disabled);
        item.addEventListener('pointerdown', (event) => {
          if (item.disabled || event.button !== undefined && event.button !== 0) return;
          event.preventDefault();
          state.buildDrag = { card, cardIndex, pointerId: event.pointerId, ghost: createBuildDragGhost(card) };
          updateBuildDrag(event);
        });
        item.addEventListener('click', () => {
          if (!item.disabled) chooseBuildCard(card, cardIndex, actions);
        });
      } else {
        item.addEventListener('click', () => showCardDetail(card));
      }
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-haspopup', 'dialog');
      item.setAttribute('aria-label', `${description.label} 卡牌详情`);
      item.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        if (buildMode) chooseBuildCard(card, cardIndex, actions);
        else showCardDetail(card);
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
    const purchaseControls = panel.querySelector('.purchase-controls');
    const me = snapshot.players.find((player) => player.id === state.enginePlayerId);
    const active = snapshot.players.find((player) => player.seat === snapshot.activeSeat);
    const isMyTurn = me?.seat === snapshot.activeSeat;
    const canAct = isMyTurn && !state.phaseNoticePlaying && state.phaseNoticeQueue.length === 0;
    const purchase = me?.purchase || { faceUp: 0, blind: 0 };
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
      item.dataset.purchaseSlot = String(index);
      item.dataset.purchaseCard = card;
      item.disabled = state.phaseNoticePlaying || state.phaseNoticeQueue.length > 0 || !faceUpActions.has(card);
      item.setAttribute('aria-pressed', String(state.selectedPurchaseSlot === index));
      item.setAttribute('aria-label', `${cardDescription(card).label}，${item.disabled ? '当前不可购买' : '选择后确认购买'}`);
      renderCardDetail(item, card);
      item.classList.add('purchase-market-card');
      item.classList.toggle('is-selected', state.selectedPurchaseSlot === index);
      item.addEventListener('click', () => purchaseHandlers.selectSlot(index));
      return item;
    }));
    const selectedCardIndex = state.selectedPurchaseSlot;
    const selectedCard = Number.isInteger(selectedCardIndex) ? faceUpCards[selectedCardIndex] : null;
    $('purchase-selection-status').textContent = state.phaseNoticePlaying || state.phaseNoticeQueue.length
      ? '阶段提示播放中，请稍候'
      : !isMyTurn
      ? `等待 P${active?.seat || '—'} 结束购牌后轮到你`
      : purchase.faceUp > 0 && purchase.blind > 0
        ? '已购买明牌和盲牌；请点击“结束购牌”交给下一位玩家'
        : purchase.faceUp > 0
          ? '已购买明牌；还可购买 1 张盲牌，或点击“结束购牌”交给下一位玩家'
          : purchase.blind > 0
            ? '已购买盲牌；还可购买 1 张明牌，或点击“结束购牌”交给下一位玩家'
            : '请选择一张明牌，或购买一张盲牌';
    const confirm = $('purchase-confirm');
    confirm.disabled = !canAct || purchase.faceUp > 0 || !selectedCard || !faceUpActions.has(selectedCard);
    confirm.onclick = () => void purchaseHandlers.confirm();
    const random = $('purchase-random');
    random.disabled = !canAct || purchase.blind > 0 || !actions.some((action) => action.type === 'purchase_blind');
    random.onclick = () => void purchaseHandlers.random();
    const pass = $('purchase-pass');
    pass.disabled = !canAct || !actions.some((action) => action.type === 'pass_purchase');
    pass.className = canAct ? 'primary-button' : 'secondary-button';
    pass.onclick = () => void purchaseHandlers.pass();
    purchaseControls.hidden = !canAct;
  }

  function renderActions(actions) {
    renderPurchaseActions(actions);
    const actionsPanel = $('legal-actions');
    const actionAp = $('action-ap');
    const actionPass = $('action-pass');
    const currentPhase = state.snapshot?.phase || document.querySelector('.phase-step.is-current')?.dataset.phase;
    if (currentPhase !== 'action') {
      state.actionMode = null;
      state.buildDraft = null;
      state.dispatchDraft = null;
      state.recruitDraft = null;
      actionAp.hidden = true;
      actionPass.hidden = true;
    }
    if (currentPhase === 'purchase') {
      actionsPanel.replaceChildren();
      return;
    }
    const host = currentPhase
      ? document.querySelector(`.phase-step[data-phase="${currentPhase}"] .phase-step-actions`)
      : null;
    if (host && actionsPanel && host !== actionsPanel && actionsPanel.parentElement !== host) host.append(actionsPanel);
    if (currentPhase !== 'action') {
      actionsPanel.replaceChildren();
      return;
    }
    if (state.buildDraft?.action && !actions.some((action) => action.type === 'build'
      && action.building === state.buildDraft.building
      && coordKey(action.at) === coordKey(state.buildDraft.at))) {
      state.buildDraft = null;
    }
    if (state.dispatchDraft?.action && !actions.some((action) => action.type === 'dispatch')) {
      state.dispatchDraft = null;
    }
    const me = state.snapshot?.players?.find((player) => player.id === state.enginePlayerId) || state.snapshot?.players?.[0];
    const totalAp = window.CONFIG_312?.start?.ap ?? 3;
    actionAp.hidden = false;
    actionAp.textContent = `AP ${me?.ap ?? 0} / ${totalAp}`;
    const canAct = me?.seat === state.snapshot?.activeSeat && !state.phaseNoticePlaying && state.phaseNoticeQueue.length === 0;
    if (!canAct && (state.actionMode || state.buildDraft || state.dispatchDraft || state.recruitDraft)) {
      clearActionSelection({ refresh: false });
    }
    const typeGroups = [
      { type: 'build', label: '建造', actions: actions.filter((action) => action.type === 'build') },
      { type: 'dispatch', label: '派遣', actions: actions.filter((action) => action.type === 'dispatch' || action.type === 'deploy') },
      { type: 'recruit', label: '招募', actions: actions.filter((action) => action.type === 'recruit') },
    ];
    actionsPanel.replaceChildren(...typeGroups.map((group) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'action-entry';
      button.disabled = !canAct || !group.actions.length;
      button.dataset.actionType = group.type;
      button.setAttribute('aria-pressed', String(state.actionMode === group.type));
      button.textContent = group.label;
      button.addEventListener('click', () => {
        state.actionMode = group.type;
        if (state.actionMode !== 'build') clearBuildDraft({ refresh: false });
        if (state.actionMode !== 'dispatch') clearDispatchDraft({ refresh: false });
        if (state.actionMode !== 'recruit') state.recruitDraft = null;
        if (state.actionMode === 'build') {
          renderBoard(state.snapshot);
          renderHandPage(state.hand);
        }
        if (state.actionMode === 'dispatch') renderBoard(state.snapshot);
        renderActions(actions);
      });
      return button;
    }));
    const selectedGroup = typeGroups.find((group) => group.type === state.actionMode);
    if (selectedGroup && selectedGroup.type !== 'build') {
      const subactions = document.createElement('div');
      subactions.className = 'action-subactions';
      subactions.setAttribute('aria-label', `${selectedGroup.label}可选行动`);
      for (const action of selectedGroup.actions.filter((candidate) => candidate.type === 'deploy')) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'action-button';
        button.disabled = !canAct;
        button.dataset.actionType = action.type;
        button.textContent = actionLabel(action);
        const meta = actionMeta(action);
        if (meta) button.setAttribute('aria-label', `${actionLabel(action)}，${meta}`);
        button.addEventListener('click', () => void submitAction(action));
        subactions.append(button);
      }
      actionsPanel.append(subactions);
    }
    if (state.actionMode === 'build') {
      const confirm = document.createElement('button');
      confirm.id = 'build-confirm';
      confirm.type = 'button';
      confirm.className = 'primary-button build-confirm';
      confirm.textContent = '确认建造';
      confirm.disabled = !canAct || !state.buildDraft?.action;
      confirm.addEventListener('click', () => void submitBuildDraft(actions));
      actionsPanel.append(confirm);
    }
    if (state.actionMode === 'dispatch') {
      renderDispatchSummary(actionsPanel, canAct);
      const endpoint = document.createElement('button');
      endpoint.id = 'dispatch-confirm-endpoint';
      endpoint.type = 'button';
      endpoint.className = 'secondary-button';
      endpoint.textContent = '确认终点';
      endpoint.disabled = !canAct || !state.dispatchDraft?.route?.length;
      endpoint.onclick = () => {
        if (!state.dispatchDraft) return;
        state.dispatchDraft.endLocked = true;
        updateDispatchAction();
        renderDispatchSurface(actions);
      };
      actionsPanel.append(endpoint);
      const confirm = document.createElement('button');
      confirm.id = 'dispatch-confirm';
      confirm.type = 'button';
      confirm.className = 'primary-button';
      confirm.textContent = '确认派遣';
      confirm.disabled = !canAct || !state.dispatchDraft?.endLocked || !state.dispatchDraft?.action
        || dispatchTotals(state.dispatchDraft.allocations).militia + dispatchTotals(state.dispatchDraft.allocations).guard < 1;
      confirm.onclick = () => void submitDispatchDraft(actions);
      actionsPanel.append(confirm);
    }
    if (state.actionMode === 'recruit') renderRecruitPanel(actionsPanel, actions, canAct);
    if (state.actionMode) {
      const abandon = document.createElement('button');
      abandon.type = 'button';
      abandon.className = 'secondary-button';
      abandon.textContent = '放弃';
      abandon.onclick = () => clearActionSelection();
      actionsPanel.append(abandon);
    }
    const passAction = actions.find((action) => action.type === 'pass');
    actionPass.hidden = !passAction;
    actionPass.disabled = !canAct || !passAction;
    actionPass.setAttribute('aria-label', '跳过本轮行动');
    actionPass.textContent = '跳过';
    actionPass.onclick = async () => {
      if (!passAction) return;
      const accepted = await submitAction(passAction);
      if (accepted) clearActionSelection();
    };
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

  function renderSnapshot(snapshot, phaseNotices = undefined) {
    if (!snapshot) return;
    const previousActiveSeat = state.lastActiveSeat;
    const previousPhase = state.lastPhase;
    state.snapshot = snapshot;
    state.lastActiveSeat = snapshot.activeSeat;
    state.lastPhase = snapshot.phase;
    const notices = phaseNotices === undefined
      ? (previousPhase === null || previousPhase !== snapshot.phase ? [{ id: `local:${snapshot.seq}:${snapshot.phase}`, kind: 'phase', phase: snapshot.phase, initial: previousPhase === null }] : [])
      : phaseNotices;
    enqueuePhaseNotices(snapshot, notices);
    if (state.mode === 'player') {
      setStatus(`已同步 · 房间 ${state.room || '—'} · 序号 ${snapshot.seq}`);
    }
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
    renderPhaseGuide(snapshot, previousPhase, previousActiveSeat);
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

  function reportTransportFailure(label, error) {
    const detail = error?.message || String(error || '未知传输错误');
    setError(new Error(`${label}失败：${detail}`));
  }

  async function broadcastState(target = null, requestId = undefined) {
    if (!state.started) return;
    const targets = target ? [target] : [...state.roomState.players.keys()];
    const failures = [];
    await Promise.all(targets.map(async (playerId) => {
      const player = state.roomState.players.get(playerId);
      try {
        await sendEnvelope(Room.makeEnvelope({
          room: state.room,
          type: 'state',
          from: state.hostId,
          to: playerId,
          requestId: target && playerId === target ? requestId : undefined,
          seq: state.game.seq,
          payload: {
            snapshot: Engine.snapshot(state.game, player?.engineId || playerId),
            phaseNotices: state.phaseNotices || [],
          },
        }));
      } catch (error) {
        failures.push({ playerId, error });
        reportTransportFailure(`P${player?.seat || playerId} 状态同步`, error);
      }
    }));
    publishDebug();
    return failures;
  }

  async function sendRoster(target = null) {
    renderRoster([...state.roomState.players.values()].map(({ id, name, seat }) => ({ id, name, seat })));
    renderHostLog(state.game);
    try {
      await sendEnvelope(Room.makeEnvelope({
        room: state.room,
        type: 'roster',
        from: state.hostId,
        to: target,
        payload: { players: [...state.roomState.players.values()].map(({ id, name, seat }) => ({ id, name, seat })) },
      }));
    } catch (error) {
      reportTransportFailure('席位列表同步', error);
    }
  }

  async function sendWaiting(target, requestId) {
    try {
      await sendEnvelope(Room.makeEnvelope({
        room: state.room,
        type: 'waiting',
        from: state.hostId,
        to: target,
        requestId,
        payload: { joined: state.roomState.players.size, required: Room.PLAYER_COUNT, started: false },
      }));
    } catch (error) {
      reportTransportFailure('等待状态同步', error);
    }
  }

  function settleAutomatic() {
    while (state.game.phase === 'combat' || state.game.phase === 'black') state.game = Engine.advance(state.game);
  }

  function settleHostAutomatic() {
    const notices = [];
    while (state.game && !state.game.result && ['exploration', 'production', 'combat', 'black'].includes(state.game.phase)) {
      const before = state.game;
      state.game = Engine.advance(state.game);
      notices.push(...noticesForAdvance(before, state.game));
    }
    return notices;
  }

  function settleHostCommandNotices(beforePhase) {
    const afterPhase = state.game.phase;
    const commandNotice = beforePhase === afterPhase ? null : makePhaseNotice(afterPhase);
    return PhaseNotices.commandPhaseNotices(beforePhase, afterPhase, commandNotice, settleHostAutomatic());
  }

  async function startGameAfterAllSeats() {
    if (state.started || !state.roomState || state.roomState.players.size !== Room.PLAYER_COUNT) return false;
    state.started = true;
    state.phaseNotices = [makePhaseNotice(state.game.phase, true), ...settleHostAutomatic()];
    renderHostLog(state.game);
    await broadcastState();
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
      const phaseBeforeCommand = state.game.phase;
      state.game = Engine.applyCommand(state.game, { seq: command.seq, playerId: player.engineId, action: command.action }).state;
      state.phaseNotices = settleHostCommandNotices(phaseBeforeCommand);
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
    const startedNow = await startGameAfterAllSeats();
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

  function resetPhaseNotices() {
    if (state.phaseBannerTimer) clearTimeout(state.phaseBannerTimer);
    state.phaseBannerTimer = null;
    state.phaseNoticeCounter = 0;
    state.phaseNoticeSeen = new Set();
    state.phaseNoticeQueue = [];
    state.phaseNoticePlaying = false;
    state.phaseNotices = [];
    state.collapsedPhases.clear();
    const banner = $('phase-transition-banner');
    if (banner) {
      banner.classList.remove('is-visible');
      banner.hidden = true;
    }
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
    state.lastPhase = null;
    state.selectedPurchaseSlot = null;
    state.actionMode = null;
    state.buildDraft = null;
    state.buildDrag = null;
    state.dispatchDraft = null;
    state.recruitDraft = null;
    resetPhaseNotices();
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
      state.lastPhase = null;
      state.selectedPurchaseSlot = null;
      state.actionMode = null;
      state.buildDraft = null;
      state.buildDrag = null;
      state.dispatchDraft = null;
      state.recruitDraft = null;
      resetPhaseNotices();
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
      state.lastPhase = null;
      state.selectedPurchaseSlot = null;
      state.actionMode = null;
      state.buildDraft = null;
      state.buildDrag = null;
      state.dispatchDraft = null;
      state.recruitDraft = null;
      resetPhaseNotices();
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
          state: (message) => renderSnapshot(message.payload?.snapshot, message.payload?.phaseNotices),
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
      state.lastPhase = null;
      resetPhaseNotices();
      state.selectedPurchaseSlot = null;
      state.actionMode = null;
      state.buildDraft = null;
      state.buildDrag = null;
      state.dispatchDraft = null;
      state.recruitDraft = null;
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
    if (!state.snapshot) return false;
    if (state.phaseNoticePlaying || state.phaseNoticeQueue.length > 0) return false;
    if (state.mode === 'simulation') {
      try {
        state.game = Engine.applyCommand(state.game, { seq: state.snapshot.seq, playerId: state.enginePlayerId, action }).state;
        settleAutomatic();
        renderSnapshot(Engine.snapshot(state.game, state.enginePlayerId));
        return true;
      } catch (error) { setError(error); return false; }
    }
    if (!state.transport || state.mode === 'host') return false;
    try {
      await state.transport.sendCommand({ seq: state.snapshot.seq, playerId: state.enginePlayerId, action });
      return true;
    } catch (error) { setError(error); return false; }
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
          const phaseBeforeCommand = state.game.phase;
          state.game = Engine.applyCommand(state.game, { seq: data.seq, playerId: player.id, action: data.action }).state;
          state.phaseNotices = settleHostCommandNotices(phaseBeforeCommand);
          renderHostLog(state.game);
          await broadcastState();
        } catch (error) { state.debugChannel.postMessage({ type: 'debug_error', message: error.message }); }
      }
    };
  }

  $('create-room').addEventListener('click', startHost);
  $('quick-simulate').addEventListener('click', startQuickSimulation);
  bindPhaseToggleButtons();
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
    if (event.key === 'Escape') {
      if (state.actionMode === 'build') {
        clearBuildDraft();
        renderActions(state.snapshot?.legalActions || []);
      }
      closeTileDetail();
    }
  });
  document.addEventListener('pointerdown', unlockTurnAudio, { passive: true });
  document.addEventListener('pointermove', updateBuildDrag, { passive: true });
  document.addEventListener('pointerup', (event) => finishBuildDrag(event), { passive: true });
  document.addEventListener('pointercancel', (event) => finishBuildDrag(event, true), { passive: true });
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
