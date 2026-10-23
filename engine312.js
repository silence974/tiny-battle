const DEFAULT_CONFIG = typeof require === 'function' ? require('./config-312') : window.CONFIG_312;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function key(coord) {
  return `${coord[0]},${coord[1]}`;
}

function sameCoord(a, b) {
  return a[0] === b[0] && a[1] === b[1];
}

function adjacent(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) === 1;
}

function hasAdjacentControlledTerritory(state, coord, playerId) {
  return Object.values(state.board).some((tile) => {
    return adjacent(coord, tile.coord) && tile.owner === playerId && tile.controlled && tile.explored;
  });
}

function makeRng(seed) {
  let value = (Number(seed) >>> 0) || 1;
  return {
    next() {
      value = (Math.imul(1664525, value) + 1013904223) >>> 0;
      return value / 0x100000000;
    },
    state() {
      return value;
    },
  };
}

function unitPower(forces, config) {
  return Object.entries(forces || {}).reduce((sum, [unit, count]) => {
    return sum + (config.units[unit]?.power || 0) * (count || 0);
  }, 0);
}

function unitCount(forces) {
  return Object.values(forces || {}).reduce((sum, count) => sum + (count || 0), 0);
}

function isEffectiveBarracks(tile, playerId, config) {
  if (!tile || tile.owner !== playerId || !tile.controlled || !tile.explored) return false;
  const recruitment = config.recruitment || {};
  if (recruitment.requireBarracks !== false && tile.building !== 'barracks') return false;
  if (recruitment.requiresStationedUnit !== false && unitCount(tile.garrison) <= 0) return false;
  return true;
}

function hasRecruitmentEligibility(state, player, config) {
  return player.recruitmentEligibleRound === state.round;
}

function emptyForces() {
  return { militia: 0, guard: 0 };
}

function addForces(a, b) {
  return { militia: (a.militia || 0) + (b.militia || 0), guard: (a.guard || 0) + (b.guard || 0) };
}

function subtractForces(a, b) {
  return { militia: (a.militia || 0) - (b.militia || 0), guard: (a.guard || 0) - (b.guard || 0) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function playerById(state, id) {
  const player = state.players.find((candidate) => candidate.id === id);
  assert(player, `unknown player: ${id}`);
  return player;
}

function activePlayer(state) {
  return state.players.find((player) => player.seat === state.activeSeat);
}

function buildDeck(config) {
  const deck = [];
  for (const [type, count] of Object.entries(config.black.baseDeck)) {
    for (let i = 0; i < count; i += 1) deck.push(type);
  }
  return deck;
}

function buildEventDeck(config) {
  const deck = [];
  for (const card of config.exploration?.eventDeck || []) {
    for (let i = 0; i < (card.count || 1); i += 1) deck.push(clone(card));
  }
  return deck;
}

function drawEvent(state, config) {
  if (!state.eventDeck?.length) return null;
  return clone(state.eventDeck.shift());
}

function makeBoard(config) {
  const board = {};
  for (let row = 0; row < config.board.rows; row += 1) {
    for (let col = 0; col < config.board.cols; col += 1) {
      board[`${row},${col}`] = {
        coord: [row, col],
        kind: 'unknown',
        explored: false,
        owner: null,
        garrison: emptyForces(),
        building: null,
        blackPower: 0,
        blackReward: 0,
        blackRewardTaken: false,
        permanentPointAwarded: false,
        event: null,
        productionLastRound: { gold: 0, wood: 0, food: 0 },
        controlled: false,
        blackUnderlying: null,
      };
    }
  }
  for (const [seat, coord] of Object.entries(config.board.playerHQ)) {
    const hq = board[key(coord)];
    hq.kind = 'hq';
    hq.explored = true;
    hq.owner = `p${seat}`;
    hq.garrison = clone(config.start.units);
    hq.controlled = true;
  }
  const blackHQ = board[key(config.board.blackHQ)];
  blackHQ.kind = 'black_hq';
  blackHQ.explored = true;
  blackHQ.owner = 'black';
  blackHQ.blackPower = config.black.hqInitialPower;
  blackHQ.controlled = false;
  return board;
}

function makePlayer(input, config) {
  return {
    id: input.id,
    name: input.name || input.id,
    seat: input.seat,
    resources: clone(config.start.resources),
    units: clone(config.start.units),
    reserve: clone(config.start.reserve),
    hand: ['farm'],
    ap: config.start.ap,
    passed: false,
    purchase: { faceUp: 0, blind: 0 },
    recruitmentEligibleRound: null,
    permanentPoints: 0,
    score: 0,
    scoreBreakdown: { controlledTiles: 0, buildings: 0, permanent: 0, hq: 0 },
  };
}

function makeMarket(config) {
  return {
    faceUp: Object.keys(config.buildings).slice(0, config.purchase.faceUpSlots),
    blind: Object.keys(config.buildings),
  };
}

function createGame({ seed = 1, players, config = DEFAULT_CONFIG }) {
  assert(Array.isArray(players) && players.length === 4, 'exactly four players are required');
  const normalized = players.map((player, index) => ({
    id: player.id || `p${index + 1}`,
    name: player.name || `Player ${index + 1}`,
    seat: player.seat || index + 1,
  }));
  const state = {
    version: '312-web-1',
    configId: config.id,
    seed,
    rng: makeRng(seed).state(),
    round: 1,
    phase: 'exploration',
    activeSeat: 1,
    seq: 0,
    board: makeBoard(config),
    players: normalized.map((player) => makePlayer(player, config)),
    market: makeMarket(config),
    expeditions: [],
    pendingAttacks: [],
    displacements: [],
    black: { deck: buildDeck(config), discard: [], expansionStep: 1, powerBonus: 0, finalBattleAdded: 0 },
    eventDeck: buildEventDeck(config),
    events: [],
    result: null,
  };
  return recomputeScores(state, config);
}

function productionForTile(tile, config) {
  if (!tile.building || !tile.owner || !tile.explored) return { gold: 0, wood: 0, food: 0 };
  const building = config.buildings[tile.building];
  if (!building.production) return { gold: 0, wood: 0, food: 0 };
  const capacity = (tile.garrison.militia || 0) * config.units.militia.capacity
    + (tile.garrison.guard || 0) * config.units.guard.capacity;
  const amount = capacity >= 3 ? building.production.tier3 : capacity >= 2 ? building.production.tier2 : 0;
  return { gold: building.production.resource === 'gold' ? amount : 0, wood: building.production.resource === 'wood' ? amount : 0, food: building.production.resource === 'food' ? amount : 0 };
}

function currentProductionForTile(tile, config) {
  if (tile.kind === 'hq' && tile.owner) {
    const capacity = (tile.garrison.militia || 0) * config.units.militia.capacity
      + (tile.garrison.guard || 0) * config.units.guard.capacity;
    const tier = (config.hqProductionTiers || []).find((candidate) => capacity >= candidate.minCapacity && capacity <= candidate.maxCapacity)
      || config.hqProduction;
    return { gold: tier.gold || 0, wood: tier.wood || 0, food: tier.food || 0 };
  }
  return productionForTile(tile, config);
}

function recomputeScores(input, config = DEFAULT_CONFIG) {
  const state = clone(input);
  for (const player of state.players) {
    let controlledTiles = 0;
    let buildings = 0;
    let hq = 0;
    for (const tile of Object.values(state.board)) {
      if (tile.owner !== player.id || !tile.controlled) continue;
      if (tile.kind !== 'hq') controlledTiles += 1;
      if (tile.building) buildings += config.buildings[tile.building]?.points || 0;
      if (tile.kind === 'black_hq') hq += config.black.hqPoints;
    }
    const permanent = player.permanentPoints || 0;
    player.scoreBreakdown = { controlledTiles, buildings, permanent, hq };
    player.score = controlledTiles + buildings + permanent + hq;
  }
  return state;
}

function updateControl(tile) {
  tile.controlled = Boolean(tile.owner && tile.explored && unitCount(tile.garrison) > 0);
}

function snapshot(input, viewerId, config = DEFAULT_CONFIG) {
  const state = recomputeScores(input, config);
  return {
    version: state.version,
    seed: state.seed,
    round: state.round,
    phase: state.phase,
    activeSeat: state.activeSeat,
    seq: state.seq,
    board: Object.values(state.board).map((tile) => ({
      coord: tile.coord,
      kind: tile.kind,
      explored: tile.explored,
      owner: tile.owner,
      controlled: tile.controlled,
      garrison: tile.explored ? clone(tile.garrison) : null,
      building: tile.explored ? tile.building : null,
      production: tile.explored ? clone(currentProductionForTile(tile, config)) : null,
      blackPower: tile.kind.startsWith('black') ? tile.blackPower : null,
      expeditions: state.expeditions.filter((expedition) => sameCoord(expedition.target, tile.coord)).map((expedition) => ({ playerId: expedition.playerId, power: expedition.power })),
    })),
    players: state.players.map((player) => {
      const visible = {
        id: player.id,
        name: player.name,
        seat: player.seat,
        resources: clone(player.resources),
        reserve: clone(player.reserve),
        ap: player.ap,
        score: player.score,
        scoreBreakdown: clone(player.scoreBreakdown),
      };
      if (player.id === viewerId) {
        visible.hand = [...player.hand];
        visible.purchase = clone(player.purchase);
      }
      return visible;
    }),
    market: clone(state.market),
    legalActions: viewerId ? legalActions(state, viewerId, config) : [],
    eventLog: state.events.slice(-20).map((event) => clone(event)),
    outcome: outcome(state, config),
  };
}

function legalActions(state, playerId, config = DEFAULT_CONFIG) {
  const player = playerById(state, playerId);
  if (state.result || player.seat !== state.activeSeat) return [];
  if (state.phase === 'purchase') {
    const actions = [{ type: 'pass_purchase' }];
    if (player.purchase.faceUp < config.purchase.maxFaceUp) {
      for (const card of state.market.faceUp) {
        if (player.resources.gold >= config.buildings[card].buyGold) actions.push({ type: 'purchase_face_up', card });
      }
    }
    if (player.purchase.blind < config.purchase.maxBlind && player.resources.gold >= config.purchase.blindGoldPrice) actions.push({ type: 'purchase_blind' });
    return actions;
  }
  if (state.phase !== 'action' || player.ap <= 0 || player.passed) return [];
  const actions = [{ type: 'pass' }];
  for (const [coord, tile] of Object.entries(state.board)) {
    if (tile.explored && tile.kind === 'land' && !tile.building && tile.owner !== 'black' && hasAdjacentControlledTerritory(state, tile.coord, player.id)) {
      for (const building of player.hand) {
        const cost = config.buildings[building]?.build;
        if (cost && canPay(player.resources, cost)) actions.push({ type: 'build', at: tile.coord, building });
      }
    }
  }
  if (hasRecruitmentEligibility(state, player, config)) {
    const maxRecruit = config.recruitment?.maxPerAction || 2;
    for (const [coord, tile] of Object.entries(state.board)) {
      if (!isEffectiveBarracks(tile, player.id, config)) continue;
      for (const unit of Object.keys(config.units)) {
        for (let count = 1; count <= maxRecruit; count += 1) {
          const cost = Object.fromEntries(Object.entries(config.units[unit].recruit || {}).map(([resource, amount]) => [resource, amount * count]));
          if (canPay(player.resources, cost)) actions.push({ type: 'recruit', at: tile.coord, unit, count });
        }
      }
    }
  }
  for (const unit of Object.keys(player.reserve)) {
    for (let count = 1; count <= player.reserve[unit]; count += 1) {
      actions.push({ type: 'deploy', unit, count });
    }
  }
  for (const [coord, tile] of Object.entries(state.board)) {
    if (tile.owner !== player.id || !tile.controlled || unitCount(tile.garrison) <= 0) continue;
    const from = tile.coord;
    for (const target of Object.values(state.board)) {
      if (!adjacent(from, target.coord) || (target.kind === 'hq' && target.owner !== player.id)) continue;
      for (const unit of Object.keys(tile.garrison)) {
        if (!tile.garrison[unit]) continue;
        const forces = emptyForces();
        forces[unit] = 1;
        if (tile.kind === 'hq' && unitCount(subtractForces(tile.garrison, forces)) === 0) continue;
        if (target.kind === 'hq' && unitCount(subtractForces(tile.garrison, forces)) === 0) continue;
        actions.push({ type: 'dispatch', from: [...from], to: [...target.coord], route: [[...target.coord]], forces });
      }
    }
  }
  return actions;
}

function canPay(resources, cost) {
  return Object.entries(cost).every(([resource, amount]) => (resources[resource] || 0) >= amount);
}

function pay(resources, cost) {
  for (const [resource, amount] of Object.entries(cost)) resources[resource] -= amount;
}

function validateRoute(state, action) {
  assert(Array.isArray(action.route) && action.route.length > 0, 'route is required');
  assert(sameCoord(action.route[action.route.length - 1], action.to), 'route must end at target');
  let previous = action.from;
  for (let index = 0; index < action.route.length; index += 1) {
    const step = action.route[index];
    assert(adjacent(previous, step), 'route must use cardinal adjacent steps');
    if (index < action.route.length - 1) {
      const transit = state.board[key(step)];
      assert(transit && transit.owner === action.playerId && transit.controlled, 'route must use connected controlled tiles');
    }
    previous = step;
  }
}

function dispatch(state, player, action, config) {
  const origin = state.board[key(action.from)];
  assert(origin && origin.owner === player.id, 'dispatch origin is not controlled');
  validateRoute(state, { ...action, playerId: player.id });
  const allocations = Array.isArray(action.routeForces) && action.routeForces.length
    ? action.routeForces
    : [{ at: action.from, forces: action.forces || emptyForces() }];
  const routeSources = new Set([key(action.from), ...action.route.slice(0, -1).map(key)]);
  const takenByTile = new Map();
  for (const allocation of allocations) {
    const source = state.board[key(allocation.at)];
    assert(source && source.owner === player.id && source.explored, 'force source is not controlled');
    assert(routeSources.has(key(allocation.at)), 'force source must be on the route');
    assert(!sameCoord(allocation.at, action.to), 'cannot take forces from target');
    const forces = { militia: allocation.forces?.militia || 0, guard: allocation.forces?.guard || 0 };
    assert(forces.militia >= 0 && forces.guard >= 0 && unitCount(forces) > 0, 'invalid force count');
    const previous = takenByTile.get(key(allocation.at)) || emptyForces();
    takenByTile.set(key(allocation.at), addForces(previous, forces));
  }
  const forces = [...takenByTile.values()].reduce((total, value) => addForces(total, value), emptyForces());
  for (const [sourceKey, taken] of takenByTile.entries()) {
    const source = state.board[sourceKey];
    assert(taken.militia <= source.garrison.militia && taken.guard <= source.garrison.guard, 'not enough forces');
    assert(source.kind !== 'hq' || unitCount(subtractForces(source.garrison, taken)) > 0, 'HQ last soldier is protected');
  }
  const extra = Math.max(0, action.route.length - config.movement.freeTiles);
  const food = extra * config.movement.compensationFoodPerExtraTile;
  assert(player.resources.food >= food, 'not enough food for route');
  for (const [sourceKey, taken] of takenByTile.entries()) {
    const source = state.board[sourceKey];
    source.garrison = subtractForces(source.garrison, taken);
    updateControl(source);
  }
  player.resources.food -= food;
  const target = state.board[key(action.to)];
  const expedition = { playerId: player.id, target: [...action.to], from: [...action.from], route: clone(action.route), forces, power: unitPower(forces, config) };
  if (!target.explored) {
    const existing = state.expeditions.find((item) => item.playerId === player.id && sameCoord(item.target, action.to));
    if (existing) {
      existing.forces = addForces(existing.forces, forces);
      existing.power += expedition.power;
      existing.route = clone(action.route);
    } else state.expeditions.push(expedition);
  } else if (target.owner === player.id && (target.kind === 'land' || target.kind === 'hq')) {
    target.garrison = addForces(target.garrison, forces);
    updateControl(target);
  } else {
    state.pendingAttacks.push(expedition);
  }
  return { food, forces };
}

function completePurchase(state) {
  return state.players.every((player) => player.purchase.done || player.purchase.faceUp >= 0 && player.purchase.passed);
}

function nextActive(state) {
  const current = state.activeSeat;
  state.activeSeat = current === 4 ? 1 : current + 1;
}

function resetActionCycle(state) {
  for (const player of state.players) {
    if (player.ap > 0) player.passed = false;
  }
  state.activeSeat = 1;
}

function actionCycleComplete(state) {
  return state.players.every((player) => player.ap <= 0 || player.passed);
}

function applyCommand(input, command, config = DEFAULT_CONFIG) {
  const state = clone(input);
  assert(command.seq === state.seq, `stale sequence: expected ${state.seq}`);
  const player = playerById(state, command.playerId);
  assert(!state.result, 'game has ended');
  assert(player.seat === state.activeSeat, 'not active seat');
  const action = command.action || {};

  if (state.phase === 'purchase') {
    if (action.type === 'purchase_face_up') {
      assert(player.purchase.faceUp < config.purchase.maxFaceUp, 'face-up purchase limit reached');
      const index = state.market.faceUp.indexOf(action.card);
      assert(index >= 0, 'card is not face-up');
      const cost = config.buildings[action.card].buyGold;
      assert(player.resources.gold >= cost, 'not enough gold');
      player.resources.gold -= cost;
      player.hand.push(action.card);
      player.purchase.faceUp += 1;
      state.market.faceUp[index] = state.market.blind[(state.seq + index) % state.market.blind.length];
    } else if (action.type === 'purchase_blind') {
      assert(player.purchase.blind < config.purchase.maxBlind, 'blind purchase limit reached');
      assert(player.resources.gold >= config.purchase.blindGoldPrice, 'not enough gold');
      player.resources.gold -= config.purchase.blindGoldPrice;
      const card = state.market.blind[state.seq % state.market.blind.length];
      player.hand.push(card);
      player.purchase.blind += 1;
    } else if (action.type === 'pass_purchase') {
      player.purchase.passed = true;
      nextActive(state);
      if (state.players.every((candidate) => candidate.purchase.passed)) {
        state.phase = 'action';
        state.activeSeat = 1;
        for (const candidate of state.players) {
          candidate.ap = config.start.ap;
          candidate.passed = false;
          candidate.purchase = { ...candidate.purchase, done: true };
        }
      }
    } else assert(false, 'purchase action required');
  } else {
    assert(state.phase === 'action', `actions are not legal during ${state.phase}`);
    assert(player.ap > 0 && !player.passed, 'player has no action remaining');
    if (action.type === 'pass') {
      player.ap -= 1;
      player.passed = true;
    } else if (action.type === 'build') {
      const target = state.board[key(action.at)];
      assert(target && target.explored && target.kind === 'land', 'building requires explored ordinary land');
      assert(!target.building, 'tile already has a building');
      assert(target.owner !== 'black' && target.owner !== 'black_hq', 'cannot build on black land');
      assert(hasAdjacentControlledTerritory(state, target.coord, player.id), 'build requires adjacent controlled territory');
      assert(player.hand.includes(action.building), 'building card is not in hand');
      const cost = config.buildings[action.building].build;
      assert(canPay(player.resources, cost), 'not enough resources');
      pay(player.resources, cost);
      target.building = action.building;
      player.hand.splice(player.hand.indexOf(action.building), 1);
      player.ap -= 1;
      state.events.push({ type: 'build', playerId: player.id, at: [...action.at], building: action.building });
    } else if (action.type === 'dispatch') {
      const dispatchResult = dispatch(state, player, action, config);
      player.ap -= 1;
      state.events.push({ type: 'dispatch', playerId: player.id, from: [...action.from], to: [...action.to], route: clone(action.route), forces: clone(dispatchResult.forces) });
    } else if (action.type === 'recruit') {
      assert(hasRecruitmentEligibility(state, player, config), 'recruit requires production eligibility');
      const tile = state.board[key(action.at)];
      assert(tile && tile.owner === player.id && tile.building === 'barracks' && tile.controlled, 'recruit requires controlled barracks');
      assert(unitCount(tile.garrison) > 0, 'recruit requires stationed barracks');
      const maxRecruit = config.recruitment?.maxPerAction || 2;
      assert(Number.isInteger(action.count) && action.count > 0 && action.count <= maxRecruit, 'invalid recruit count');
      const unit = action.unit || 'militia';
      assert(config.units[unit], 'unknown recruit unit');
      const cost = config.units[unit].recruit;
      const total = Object.fromEntries(Object.entries(cost).map(([resource, value]) => [resource, value * action.count]));
      assert(canPay(player.resources, total), 'not enough resources');
      pay(player.resources, total);
      tile.garrison[unit] += action.count;
      updateControl(tile);
      player.ap -= 1;
    } else if (action.type === 'deploy') {
      const unit = action.unit || 'militia';
      assert(player.reserve[unit] >= action.count && action.count > 0, 'not enough reserve forces');
      const hq = Object.values(state.board).find((tile) => tile.kind === 'hq' && tile.owner === player.id);
      hq.garrison[unit] += action.count;
      player.reserve[unit] -= action.count;
      player.ap -= 1;
    } else assert(false, `unknown action: ${action.type}`);

    if (actionCycleComplete(state)) {
      if (state.players.every((candidate) => candidate.ap <= 0)) {
        state.phase = 'combat';
      } else resetActionCycle(state);
    } else nextActive(state);
  }

  state.seq += 1;
  state.events.push({ type: 'command', seq: state.seq, playerId: player.id, action: clone(action) });
  return { state: recomputeScores(state, config), events: state.events.slice(-2) };
}

function resolveExploration(state, config) {
  const grouped = new Map();
  for (const expedition of state.expeditions) {
    const groupKey = key(expedition.target);
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    const samePlayer = grouped.get(groupKey).find((item) => item.playerId === expedition.playerId);
    if (samePlayer) {
      samePlayer.forces = addForces(samePlayer.forces, expedition.forces);
      samePlayer.power += expedition.power;
    } else grouped.get(groupKey).push(clone(expedition));
  }
  state.expeditions = [];
  for (const [targetKey, expeditions] of grouped.entries()) {
    const target = state.board[targetKey];
    const max = Math.max(...expeditions.map((expedition) => expedition.power));
    const winners = expeditions.filter((expedition) => expedition.power === max);
    if (winners.length !== 1) {
      state.displacements.push(...expeditions.map((expedition) => ({ ...expedition, reason: 'exploration_tie' })));
      continue;
    }
    const winner = winners[0];
    if (target.kind === 'black') {
      if (winner.power <= target.blackPower) {
        state.displacements.push({ ...winner, reason: 'black_defense' });
        continue;
      }
      target.owner = winner.playerId;
      target.kind = 'land';
      target.explored = true;
      target.garrison = clone(winner.forces);
      target.blackPower = 0;
      const player = playerById(state, winner.playerId);
      if (!target.blackRewardTaken) {
        player.resources.gold += target.blackReward || config.black.standardRewardGold;
        player.permanentPoints += target.permanentPointAwarded ? 0 : 1;
        target.permanentPointAwarded = true;
        target.blackRewardTaken = true;
        target.blackReward = 0;
      }
      const underlying = target.blackUnderlying;
      target.blackUnderlying = null;
      if (underlying?.event) resolveExplorationEvent(state, target, winner, underlying.event, config, true);
    } else {
      const event = target.event || drawEvent(state, config);
      resolveExplorationEvent(state, target, winner, event, config, false);
    }
    if (target.owner === winner.playerId && target.garrison) updateControl(target);
    state.events.push({ type: 'exploration', target: target.coord, playerId: winner.playerId });
  }
  resolveDisplacements(state, config);
}

function addEventReward(player, reward) {
  for (const [resource, amount] of Object.entries(reward || {})) {
    if (resource === 'choice') continue;
    player.resources[resource] = (player.resources[resource] || 0) + amount;
  }
}

function resolveExplorationEvent(state, target, winner, event, config, afterBlack) {
  const player = playerById(state, winner.playerId);
  if (!event) {
    target.explored = true;
    target.kind = 'land';
    target.owner = winner.playerId;
    target.garrison = clone(winner.forces);
    target.event = { name: 'revealed', resolved: true, choice: 'occupy' };
    return;
  }
  const choice = winner.eventChoice || 'resource';
  target.event = { ...clone(event), choice };
  state.events.push({ type: 'exploration_event', target: target.coord, playerId: winner.playerId, name: event.name, choice });
  if (choice === 'resource') {
    addEventReward(player, event.resource);
    target.explored = true;
    target.kind = 'land';
    target.owner = winner.playerId;
    target.garrison = clone(winner.forces);
    target.event.resolved = true;
    return;
  }
  const monster = event.monster || { power: 0, points: 0, reward: {} };
  if (winner.power > monster.power) {
    player.permanentPoints += monster.points || 0;
    addEventReward(player, monster.reward);
    target.explored = true;
    target.kind = 'land';
    target.owner = winner.playerId;
    target.garrison = clone(winner.forces);
    target.event.resolved = true;
    return;
  }
  if (afterBlack && config.rules.postBlackEventFailure === 'neutral') {
    target.explored = true;
    target.kind = 'land';
    target.owner = null;
    target.garrison = emptyForces();
    target.event = null;
    state.displacements.push({ ...winner, reason: 'post_black_event' });
  } else {
    target.explored = false;
    target.kind = 'unknown';
    target.owner = null;
    target.garrison = emptyForces();
    state.displacements.push({ ...winner, reason: 'exploration_monster' });
  }
}

function resolveDisplacements(state, config) {
  for (const displacement of state.displacements) {
    if (displacement.destination) continue;
    const player = playerById(state, displacement.playerId);
    const adjacentTiles = Object.values(state.board)
      .filter((tile) => adjacent(tile.coord, displacement.target))
      .sort((a, b) => key(a.coord).localeCompare(key(b.coord)));
    const own = adjacentTiles.find((tile) => tile.owner === player.id && tile.controlled && tile.explored);
    if (own) {
      own.garrison = addForces(own.garrison, displacement.forces);
      updateControl(own);
      displacement.destination = { type: 'tile', coord: [...own.coord] };
      continue;
    }
    const unknown = adjacentTiles.find((tile) => tile.kind === 'unknown' && !tile.explored);
    if (unknown) {
      const existing = state.expeditions.find((expedition) => expedition.playerId === player.id && sameCoord(expedition.target, unknown.coord));
      if (existing) {
        existing.forces = addForces(existing.forces, displacement.forces);
        existing.power += unitPower(displacement.forces, config);
      } else {
        state.expeditions.push({ playerId: player.id, target: [...unknown.coord], from: [...displacement.target], route: [], forces: clone(displacement.forces), power: unitPower(displacement.forces, config) });
      }
      displacement.destination = { type: 'expedition', coord: [...unknown.coord] };
      continue;
    }
    player.reserve = addForces(player.reserve, displacement.forces);
    displacement.destination = { type: 'reserve' };
  }
}

function resolveCombat(state, config) {
  const byTarget = new Map();
  for (const attack of state.pendingAttacks) {
    const targetKey = key(attack.target);
    if (!byTarget.has(targetKey)) byTarget.set(targetKey, []);
    byTarget.get(targetKey).push(attack);
  }
  state.pendingAttacks = [];
  state.displacements = [];
  for (const [targetKey, attacks] of byTarget.entries()) {
    const target = state.board[targetKey];
    const max = Math.max(...attacks.map((attack) => attack.power));
    const winners = attacks.filter((attack) => attack.power === max);
    let winner = winners.length === 1 ? winners[0] : null;
    const defenderPower = target.kind.startsWith('black') ? target.blackPower : unitPower(target.garrison, config);
    if (!winner || max <= defenderPower) {
      state.displacements.push(...attacks.map((attack) => ({ ...attack, reason: !winner ? 'combat_tie' : 'defender_holds' })));
      continue;
    }
    const player = playerById(state, winner.playerId);
    if (target.kind === 'black_hq') {
      target.owner = winner.playerId;
      target.kind = 'black_hq';
      target.garrison = clone(winner.forces);
      target.blackPower = 0;
      target.controlled = true;
      state.result = { status: 'win', reason: 'black_hq_captured' };
      state.phase = 'ended';
      player.permanentPoints += config.black.hqPoints;
    } else if (target.kind === 'black') {
      const underlying = target.blackUnderlying;
      target.kind = 'land';
      target.owner = winner.playerId;
      target.explored = true;
      target.garrison = clone(winner.forces);
      target.blackPower = 0;
      target.controlled = true;
      if (!target.blackRewardTaken) {
        player.resources.gold += target.blackReward || config.black.standardRewardGold;
        player.permanentPoints += target.permanentPointAwarded ? 0 : 1;
        target.permanentPointAwarded = true;
        target.blackRewardTaken = true;
        target.blackReward = 0;
      }
      target.blackUnderlying = null;
      if (underlying?.event) resolveExplorationEvent(state, target, winner, underlying.event, config, true);
    } else {
      if (target.owner && target.owner !== winner.playerId && unitCount(target.garrison) > 0) {
        state.displacements.push({ playerId: target.owner, target: [...target.coord], forces: clone(target.garrison), reason: 'lost_tile' });
      }
      target.owner = winner.playerId;
      target.garrison = clone(winner.forces);
      target.explored = true;
      target.kind = target.kind === 'hq' ? 'hq' : 'land';
      target.controlled = true;
    }
    state.events.push({ type: 'combat', target: target.coord, winner: winner.playerId });
  }
  resolveDisplacements(state, config);
}

function applyProduction(state, config) {
  for (const player of state.players) {
    const hq = Object.values(state.board).find((tile) => tile.kind === 'hq' && tile.owner === player.id);
    if (hq) {
      const capacity = (hq.garrison.militia || 0) * config.units.militia.capacity
        + (hq.garrison.guard || 0) * config.units.guard.capacity;
      const tier = (config.hqProductionTiers || []).find((candidate) => capacity >= candidate.minCapacity && capacity <= candidate.maxCapacity)
        || config.hqProduction;
      for (const resource of Object.keys(player.resources)) player.resources[resource] += tier[resource] || 0;
      hq.productionLastRound = { gold: tier.gold || 0, wood: tier.wood || 0, food: tier.food || 0 };
    }
    player.recruitmentEligibleRound = Object.values(state.board).some((tile) => isEffectiveBarracks(tile, player.id, config))
      ? state.round
      : null;
  }
  for (const tile of Object.values(state.board)) {
    tile.productionLastRound = productionForTile(tile, config);
    if (!tile.owner || !tile.controlled) continue;
    const player = state.players.find((candidate) => candidate.id === tile.owner);
    if (!player) continue;
    for (const [resource, amount] of Object.entries(tile.productionLastRound)) player.resources[resource] += amount;
  }
}

function applyBlackExpansion(state, step, config) {
  const steps = config.board.expansionSteps || {};
  const current = new Set((steps[step] || steps[String(step)] || []).map(key));
  const previous = new Set((steps[step - 1] || steps[String(step - 1)] || []).map(key));
  const newCells = [...current].filter((coord) => !previous.has(coord));
  const displaced = [];
  for (const coordKey of newCells.sort()) {
    const target = state.board[coordKey];
    if (!target || target.kind === 'hq' || target.kind === 'black_hq' || target.kind === 'black') continue;
    if (target.kind === 'unknown') {
      const hasExpedition = state.expeditions.some((expedition) => sameCoord(expedition.target, target.coord));
      target.blackUnderlying = hasExpedition ? { type: 'unknown', event: drawEvent(state, config) } : null;
      target.kind = 'black';
      target.explored = true;
      target.owner = 'black';
      target.garrison = emptyForces();
      target.blackPower = config.black.standardPower + state.black.powerBonus;
      target.blackReward = config.black.standardRewardGold;
      continue;
    }
    if (target.kind === 'land') {
      const attackPower = config.black.expansionAttackPowerBase + config.black.expansionAttackPowerPerCard * step;
      const defenderPower = target.controlled ? unitPower(target.garrison, config) : 0;
      if (target.owner && target.controlled && defenderPower >= attackPower) continue;
      if (target.owner && unitCount(target.garrison) > 0) displaced.push({ playerId: target.owner, target: [...target.coord], forces: clone(target.garrison), reason: 'black_expansion' });
      target.blackUnderlying = { type: 'explored', building: target.building, event: target.event };
      target.kind = 'black';
      target.explored = true;
      target.owner = 'black';
      target.garrison = emptyForces();
      target.building = null;
      target.event = null;
      target.blackPower = config.black.standardPower + state.black.powerBonus;
      target.blackReward = config.black.standardRewardGold;
    }
  }
  state.displacements.push(...displaced);
  resolveDisplacements(state, config);
  state.events.push({ type: 'black_expansion', step, tiles: newCells });
}

function drawBlack(state, config) {
  const finalBattleAdded = state.black.finalBattleAdded || 0;
  if (state.round >= config.black.finalBattleStartRound && finalBattleAdded < config.black.finalBattleCount) {
    state.black.deck.push('final_battle');
    state.black.finalBattleAdded = finalBattleAdded + 1;
  }
  for (let i = 0; i < config.black.drawPerRound; i += 1) {
    if (!state.black.deck.length && state.black.discard.length) {
      state.black.deck = state.black.discard.splice(0);
    }
    const card = state.black.deck.shift();
    if (!card) break;
    state.black.discard.push(card);
    if (card === 'final_battle') {
      state.result = { status: 'loss', reason: 'final_battle' };
      state.phase = 'ended';
      return;
    }
    if (card === 'garrison') {
      state.black.powerBonus += 1;
      for (const tile of Object.values(state.board)) {
        if (tile.kind === 'black' || tile.kind === 'black_hq') tile.blackPower += 1;
      }
    }
    if (card === 'build') {
      for (const tile of Object.values(state.board)) if (tile.kind === 'black') tile.blackReward = (tile.blackReward || config.black.standardRewardGold) + 1;
    }
    if (card === 'expansion') {
      state.black.expansionStep += 1;
      applyBlackExpansion(state, state.black.expansionStep, config);
    }
  }
}

function advance(input, config = DEFAULT_CONFIG) {
  const state = clone(input);
  if (state.result) return recomputeScores(state, config);
  if (state.phase === 'exploration') {
    resolveExploration(state, config);
    state.phase = 'production';
  } else if (state.phase === 'production') {
    applyProduction(state, config);
    state.phase = 'purchase';
    state.activeSeat = 1;
    for (const player of state.players) player.purchase = { faceUp: 0, blind: 0, passed: false };
  } else if (state.phase === 'action') {
    if (state.players.every((player) => player.ap <= 0 || player.passed)) state.phase = 'combat';
  } else if (state.phase === 'combat') {
    resolveCombat(state, config);
    if (!state.result) state.phase = 'black';
  } else if (state.phase === 'black') {
    drawBlack(state, config);
    if (!state.result) {
      state.round += 1;
      state.phase = 'exploration';
      state.activeSeat = 1;
      for (const player of state.players) {
        player.ap = config.start.ap;
        player.passed = false;
      }
    }
  }
  return recomputeScores(state, config);
}

function ranking(state, config) {
  const sorted = [...state.players].sort((a, b) => {
    const score = b.score - a.score;
    if (score) return score;
    const gold = b.resources.gold - a.resources.gold;
    if (gold) return gold;
    return b.scoreBreakdown.controlledTiles - a.scoreBreakdown.controlledTiles;
  });
  let previous = null;
  let previousRank = 1;
  return sorted.map((player, index) => {
    const tied = previous && player.score === previous.score && player.resources.gold === previous.resources.gold && player.scoreBreakdown.controlledTiles === previous.scoreBreakdown.controlledTiles;
    const rank = tied ? previousRank : index + 1;
    previous = player;
    previousRank = rank;
    return {
    rank,
    playerId: player.id,
    score: player.score,
    gold: player.resources.gold,
    controlledTiles: player.scoreBreakdown.controlledTiles,
    };
  });
}

function outcome(input, config = DEFAULT_CONFIG) {
  const state = recomputeScores(input, config);
  const result = state.result;
  return {
    status: result?.status || 'ongoing',
    winners: result?.status === 'win' ? state.players.map((player) => player.id) : [],
    reason: result?.reason || null,
    ranking: ranking(state, config),
  };
}

function checkInvariants(input) {
  const state = input;
  for (const player of state.players) {
    if (Object.values(player.resources).some((value) => !Number.isFinite(value) || value < 0)) return { ok: false, reason: 'negative resource' };
    if (!Number.isInteger(player.ap) || player.ap < 0) return { ok: false, reason: 'negative AP' };
  }
  for (const tile of Object.values(state.board)) {
    if (Object.values(tile.garrison).some((value) => !Number.isInteger(value) || value < 0)) return { ok: false, reason: 'negative garrison' };
    if (tile.controlled && (!tile.owner || !tile.explored || unitCount(tile.garrison) <= 0)) return { ok: false, reason: 'invalid control' };
    if (tile.kind === 'unknown' && (tile.owner || tile.explored || tile.controlled)) return { ok: false, reason: 'unknown tile has control' };
  }
  const recomputed = recomputeScores(state);
  for (const player of state.players) {
    const expected = recomputed.players.find((candidate) => candidate.id === player.id);
    if (player.score !== expected.score) return { ok: false, reason: 'score mismatch' };
  }
  return { ok: true };
}

const ENGINE_API = {
  createGame,
  snapshot,
  legalActions,
  applyCommand,
  advance,
  outcome,
  recomputeScores,
  checkInvariants,
  key,
};

if (typeof module !== 'undefined' && module.exports) module.exports = ENGINE_API;
if (typeof window !== 'undefined') window.Engine312 = ENGINE_API;
