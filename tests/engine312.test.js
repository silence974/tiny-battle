const test = require('node:test');
const assert = require('node:assert/strict');

const CONFIG = require('../config-312');
const Engine = require('../engine312');

const PLAYERS = [1, 2, 3, 4].map((seat) => ({
  id: `p${seat}`,
  name: `Player ${seat}`,
  seat,
}));

function freshGame() {
  return Engine.createGame({ seed: 312, players: PLAYERS, config: CONFIG });
}

function stageAction(state) {
  state.phase = 'action';
  state.activeSeat = 1;
  state.pendingAttacks = [];
  for (const player of state.players) {
    player.ap = 3;
    player.passed = false;
  }
  return state;
}

function tile(state, coord) {
  return state.board[coord.join(',')];
}

function setControlledTile(state, owner, coord, garrison = { militia: 1, guard: 0 }) {
  const current = tile(state, coord);
  current.kind = 'land';
  current.explored = true;
  current.owner = owner;
  current.garrison = { ...garrison };
  current.building = null;
  current.controlled = true;
  return current;
}

function command(state, playerId, action) {
  return Engine.applyCommand(state, {
    seq: state.seq,
    playerId,
    action,
  }).state;
}

test('candidate 312 config locks the board, phases, costs, and disputed boundaries', () => {
  assert.equal(CONFIG.board.rows, 7);
  assert.equal(CONFIG.board.cols, 7);
  assert.deepEqual(CONFIG.board.blackHQ, [3, 3]);
  assert.deepEqual(CONFIG.phases, ['exploration', 'production', 'purchase', 'action', 'combat', 'black']);
  assert.equal(CONFIG.purchase.maxFaceUp, 1);
  assert.equal(CONFIG.purchase.maxBlind, 1);
  assert.equal(CONFIG.purchase.ap, 0);
  assert.equal(CONFIG.rules.blackExpansionUnknownKeepsEvent, false);
  assert.equal(CONFIG.rules.postBlackEventFailure, 'neutral');
  assert.equal(CONFIG.rules.buildRequiresControl, false);
  assert.deepEqual(CONFIG.hqProductionTiers[0], { minCapacity: 0, maxCapacity: 5, gold: 1, wood: 1, food: 0 });
  assert.deepEqual(CONFIG.hqProductionTiers[1], { minCapacity: 6, maxCapacity: 999, gold: 3, wood: 2, food: 0 });
});

test('initial state is deterministic and snapshots hide another player hand', () => {
  const first = freshGame();
  const second = freshGame();
  assert.deepEqual(first, second);
  assert.equal(first.phase, 'exploration');
  assert.equal(Object.keys(first.board).length, 49);
  assert.equal(first.players.length, 4);
  assert.ok(first.players[0].hand.length > 0);
  const viewer = Engine.snapshot(first, 'p1');
  assert.deepEqual(viewer.players.find((p) => p.id === 'p1').hand, first.players[0].hand);
  assert.equal('hand' in viewer.players.find((p) => p.id === 'p2'), false);
});

test('advance follows exploration, production, purchase, action, combat, and black order', () => {
  let state = freshGame();
  assert.equal(state.phase, 'exploration');
  state = Engine.advance(state);
  assert.equal(state.phase, 'production');
  state = Engine.advance(state);
  assert.equal(state.phase, 'purchase');
  for (const player of PLAYERS) state = command(state, player.id, { type: 'pass_purchase' });
  assert.equal(state.phase, 'action');
  for (let i = 0; i < 12; i += 1) {
    const active = state.players.find((p) => p.seat === state.activeSeat);
    state = command(state, active.id, { type: 'pass' });
  }
  assert.equal(state.phase, 'combat');
  state = Engine.advance(state);
  assert.equal(state.phase, 'black');
  state = Engine.advance(state);
  assert.ok(['exploration', 'ended'].includes(state.phase));
});

test('purchase has no AP cost and caps one face-up plus one blind card per seat', () => {
  let state = freshGame();
  state = Engine.advance(Engine.advance(state));
  const before = state.players[0].ap;
  state = command(state, 'p1', { type: 'purchase_face_up', card: state.market.faceUp[0] });
  assert.equal(state.players[0].ap, before);
  assert.throws(() => command(state, 'p1', { type: 'purchase_face_up', card: state.market.faceUp[0] }), /face-up purchase limit/);
  state = command(state, 'p1', { type: 'purchase_blind' });
  assert.equal(state.players[0].ap, before);
  assert.throws(() => command(state, 'p1', { type: 'purchase_blind' }), /blind purchase limit/);
});

test('action phase is P1-to-P4 round robin rather than one seat spending all AP', () => {
  let state = stageAction(freshGame());
  state = command(state, 'p1', { type: 'pass' });
  assert.equal(state.activeSeat, 2);
  assert.equal(state.players[0].ap, 2);
  state = command(state, 'p2', { type: 'pass' });
  assert.equal(state.activeSeat, 3);
  assert.equal(state.players[1].ap, 2);
  state = command(state, 'p3', { type: 'pass' });
  state = command(state, 'p4', { type: 'pass' });
  assert.equal(state.activeSeat, 1);
  assert.equal(state.players[0].ap, 2);
});

test('legal actions expose dispatch and recruiting, and recruitment stations units at barracks', () => {
  let state = stageAction(freshGame());
  const barracks = setControlledTile(state, 'p1', [1, 0]);
  barracks.building = 'barracks';
  const actions = Engine.legalActions(state, 'p1');
  assert.ok(actions.some((action) => action.type === 'dispatch'));
  assert.ok(actions.some((action) => action.type === 'recruit' && action.at.join(',') === '1,0'));
  assert.equal(actions.some((action) => action.type === 'deploy'), false);
  const before = { ...barracks.garrison };
  state = command(state, 'p1', { type: 'recruit', at: [1, 0], unit: 'militia', count: 1 });
  assert.deepEqual(tile(state, [1, 0]).garrison, { militia: before.militia + 1, guard: before.guard });
  assert.deepEqual(state.players[0].reserve, { militia: 0, guard: 0 });
});

test('black expansion changes the board, build increases rewards, and garrison increases power', () => {
  let state = freshGame();
  state.phase = 'black';
  state.black.deck = ['expansion', 'build', 'garrison'];
  state = Engine.advance(state);
  const blackTiles = Object.values(state.board).filter((candidate) => candidate.kind === 'black');
  assert.ok(blackTiles.length > 0);
  assert.ok(blackTiles.every((candidate) => candidate.blackReward >= CONFIG.black.standardRewardGold));
  const beforeReward = blackTiles[0].blackReward;
  const beforePower = blackTiles[0].blackPower;
  state.phase = 'black';
  state.black.deck = ['build', 'garrison'];
  state = Engine.advance(state);
  assert.equal(tile(state, blackTiles[0].coord).blackReward, beforeReward + 1);
  assert.equal(tile(state, blackTiles[0].coord).blackPower, beforePower + 1);
});

test('black expansion discards an unrevealed event without an expedition but carries it with one', () => {
  let state = freshGame();
  state.eventDeck = [{ name: 'discarded' }, { name: 'carried' }];
  state.phase = 'black';
  state.black.deck = ['expansion'];
  state = Engine.advance(state);
  const newlyBlack = Object.values(state.board).find((candidate) => candidate.kind === 'black' && candidate.coord.join(',') !== '3,3');
  assert.equal(newlyBlack.blackUnderlying, null);

  let withExpedition = freshGame();
  withExpedition.eventDeck = [{ name: 'carried' }];
  withExpedition.expeditions = [{ playerId: 'p1', target: [2, 3], forces: { militia: 1, guard: 0 }, power: 1, route: [] }];
  withExpedition.phase = 'black';
  withExpedition.black.deck = ['expansion'];
  withExpedition = Engine.advance(withExpedition);
  assert.equal(withExpedition.board['2,3'].blackUnderlying.event.name, 'carried');
});

test('combat displacement is placed on a connected controlled tile or reserve', () => {
  let state = stageAction(freshGame());
  setControlledTile(state, 'p1', [2, 1], { militia: 1, guard: 0 });
  const target = tile(state, [2, 2]);
  target.explored = true;
  target.kind = 'land';
  target.owner = 'p3';
  target.garrison = { militia: 2, guard: 0 };
  state.pendingAttacks = [
    { playerId: 'p1', target: [2, 2], forces: { militia: 2, guard: 0 }, power: 2 },
    { playerId: 'p2', target: [2, 2], forces: { militia: 2, guard: 0 }, power: 2 },
  ];
  state.phase = 'combat';
  state = Engine.advance(state);
  assert.equal(tile(state, [2, 1]).garrison.militia, 3);
  assert.ok(state.displacements.every((entry) => entry.destination));
});

test('unknown exploration resolves an event choice and failed monster fight retreats', () => {
  let state = freshGame();
  state.phase = 'exploration';
  state.expeditions = [{ playerId: 'p1', target: [1, 2], forces: { militia: 1, guard: 0 }, power: 1, route: [], eventChoice: 'fight' }];
  state.eventDeck = [{ name: 'test-monster', resource: { food: 2 }, monster: { power: 9, points: 2, reward: { food: 1 } } }];
  state = Engine.advance(state);
  assert.equal(tile(state, [1, 2]).explored, false);
  assert.ok(state.displacements.some((entry) => entry.reason === 'exploration_monster'));
  assert.ok(state.events.some((entry) => entry.type === 'exploration_event' && entry.choice === 'fight'));
});

test('a deterministic multi-round table can execute dispatch, production, action, combat, and black phases', () => {
  let state = freshGame();
  for (let round = 0; round < 3; round += 1) {
    state = Engine.advance(state);
    state = Engine.advance(state);
    while (state.phase === 'purchase') {
      const active = state.players.find((player) => player.seat === state.activeSeat);
      state = command(state, active.id, { type: 'pass_purchase' });
    }
    while (state.phase === 'action') {
      const active = state.players.find((player) => player.seat === state.activeSeat);
      const action = Engine.legalActions(state, active.id).find((candidate) => candidate.type === 'dispatch')
        || { type: 'pass' };
      state = command(state, active.id, action);
    }
    state = Engine.advance(state);
    state = Engine.advance(state);
    assert.equal(Engine.checkInvariants(state).ok, true);
    assert.ok(state.seq > round);
  }
  assert.ok(state.round >= 3);
  assert.ok(state.events.some((event) => event.type === 'black_expansion' || event.type === 'exploration_event'));
});

test('dispatch charges route length, preserves route and force allocation, and rejects taking the HQ last soldier', () => {
  let state = stageAction(freshGame());
  setControlledTile(state, 'p1', [0, 1]);
  setControlledTile(state, 'p1', [0, 2]);
  const beforeFood = state.players[0].resources.food;
  state = command(state, 'p1', {
    type: 'dispatch',
    from: [0, 0],
    to: [0, 3],
    route: [[0, 1], [0, 2], [0, 3]],
    forces: { militia: 1, guard: 0 },
  });
  assert.equal(state.players[0].resources.food, beforeFood - 1);
  assert.deepEqual(state.expeditions[0].route, [[0, 1], [0, 2], [0, 3]]);
  assert.deepEqual(state.expeditions[0].forces, { militia: 1, guard: 0 });
  let routed = stageAction(freshGame());
  setControlledTile(routed, 'p1', [0, 1], { militia: 1, guard: 1 });
  routed = command(routed, 'p1', {
    type: 'dispatch',
    from: [0, 0],
    to: [0, 2],
    route: [[0, 1], [0, 2]],
    routeForces: [
      { at: [0, 0], forces: { militia: 1, guard: 0 } },
      { at: [0, 1], forces: { militia: 1, guard: 0 } },
    ],
  });
  assert.deepEqual(routed.expeditions[0].forces, { militia: 2, guard: 0 });
  assert.deepEqual(tile(routed, [0, 1]).garrison, { militia: 0, guard: 1 });
  assert.throws(() => command(stageAction(freshGame()), 'p1', {
    type: 'dispatch', from: [0, 0], to: [0, 1], route: [[0, 1]], forces: { militia: 2, guard: 2 },
  }), /HQ last soldier/);
});

test('dispatch to an own controlled tile merges without entering combat', () => {
  let state = stageAction(freshGame());
  const target = setControlledTile(state, 'p1', [0, 1], { militia: 1, guard: 0 });
  state = command(state, 'p1', {
    type: 'dispatch', from: [0, 0], to: [0, 1], route: [[0, 1]], forces: { militia: 1, guard: 0 },
  });
  assert.deepEqual(tile(state, [0, 1]).garrison, { militia: 2, guard: 0 });
  assert.equal(state.pendingAttacks.length, 0);
});

test('building is legal on explored empty ground but production requires control', () => {
  let state = stageAction(freshGame());
  const empty = tile(state, [1, 1]);
  empty.explored = true;
  empty.kind = 'land';
  empty.owner = null;
  empty.garrison = { militia: 0, guard: 0 };
  const before = state.players[0].resources.gold;
  state = command(state, 'p1', { type: 'build', at: [1, 1], building: 'farm' });
  assert.equal(tile(state, [1, 1]).building, 'farm');
  assert.equal(tile(state, [1, 1]).owner, null);
  state = Engine.advance({ ...state, phase: 'production' });
  assert.equal(state.players[0].resources.gold, before - CONFIG.buildings.farm.build.gold + 3);
  assert.equal(tile(state, [1, 1]).productionLastRound.food, 0);
});

test('combat resolves simultaneously, ties keep the defender, and empty defenders use unique highest arrival', () => {
  let state = stageAction(freshGame());
  const target = tile(state, [2, 2]);
  target.explored = true;
  target.kind = 'land';
  target.owner = 'p3';
  target.garrison = { militia: 2, guard: 0 };
  state.pendingAttacks = [
    { playerId: 'p1', target: [2, 2], forces: { militia: 2, guard: 0 }, power: 2 },
    { playerId: 'p2', target: [2, 2], forces: { militia: 2, guard: 0 }, power: 2 },
  ];
  state.phase = 'combat';
  state = Engine.advance(state);
  assert.equal(tile(state, [2, 2]).owner, 'p3');
  assert.equal(state.displacements.length, 2);

  const empty = tile(state, [2, 3]);
  empty.owner = null;
  empty.garrison = { militia: 0, guard: 0 };
  state.pendingAttacks = [
    { playerId: 'p1', target: [2, 3], forces: { militia: 2, guard: 0 }, power: 2 },
    { playerId: 'p2', target: [2, 3], forces: { militia: 1, guard: 1 }, power: 3 },
  ];
  state.phase = 'combat';
  state = Engine.advance(state);
  assert.equal(tile(state, [2, 3]).owner, 'p2');
});

test('same-cell expeditions merge for one player and unique highest explores immediately', () => {
  let state = freshGame();
  state.phase = 'exploration';
  state.expeditions = [
    { playerId: 'p1', target: [1, 2], forces: { militia: 1, guard: 0 }, power: 1, route: [] },
    { playerId: 'p1', target: [1, 2], forces: { militia: 0, guard: 1 }, power: 2, route: [] },
    { playerId: 'p2', target: [1, 2], forces: { militia: 1, guard: 0 }, power: 1, route: [] },
  ];
  state = Engine.advance(state);
  assert.equal(state.expeditions.length, 0);
  assert.equal(tile(state, [1, 2]).owner, 'p1');
  assert.equal(state.events.some((event) => event.type === 'exploration'), true);
});

test('black zone reward is one-time, black HQ grants points without ordinary reward, and final outcome ranks players', () => {
  let state = freshGame();
  const black = tile(state, [2, 2]);
  black.kind = 'black';
  black.explored = true;
  black.blackPower = 1;
  state.pendingAttacks = [{ playerId: 'p1', target: [2, 2], forces: { militia: 3, guard: 0 }, power: 3 }];
  state.phase = 'combat';
  state = Engine.advance(state);
  assert.equal(state.players[0].permanentPoints, 1);
  const goldAfterFirst = state.players[0].resources.gold;
  black.owner = 'black';
  black.garrison = { militia: 0, guard: 0 };
  state.pendingAttacks = [{ playerId: 'p1', target: [2, 2], forces: { militia: 3, guard: 0 }, power: 3 }];
  state.phase = 'combat';
  state = Engine.advance(state);
  assert.equal(state.players[0].permanentPoints, 1);
  assert.equal(state.players[0].resources.gold, goldAfterFirst);

  const hq = tile(state, CONFIG.board.blackHQ);
  hq.kind = 'black_hq';
  hq.explored = true;
  hq.blackPower = 1;
  state.pendingAttacks = [{ playerId: 'p1', target: CONFIG.board.blackHQ, forces: { militia: 4, guard: 0 }, power: 4 }];
  state.phase = 'combat';
  state = Engine.advance(state);
  assert.equal(Engine.outcome(state).status, 'win');
  assert.equal(state.players[0].permanentPoints, 1 + CONFIG.black.hqPoints);
  assert.equal(Engine.outcome(state).ranking.length, 4);
  assert.ok(Engine.outcome(state).ranking[0].score >= Engine.outcome(state).ranking.at(-1).score);
  const tieRanks = Engine.outcome(freshGame()).ranking.map((entry) => entry.rank);
  assert.deepEqual(tieRanks, [1, 1, 1, 1]);
});

test('forced final battle is a shared loss while score ranking remains available', () => {
  let state = freshGame();
  state.round = CONFIG.black.finalBattleStartRound;
  state.phase = 'black';
  state.black.deck = ['final_battle'];
  state = Engine.advance(state);
  const result = Engine.outcome(state);
  assert.equal(result.status, 'loss');
  assert.equal(result.reason, 'final_battle');
  assert.equal(result.ranking.length, 4);
});

test('final battle cards are added one per black phase and black deck refills from discard', () => {
  let state = freshGame();
  state.round = CONFIG.black.finalBattleStartRound;
  state.phase = 'black';
  state.black.deck = ['build', 'garrison'];
  state.black.discard = ['garrison'];
  state = Engine.advance(state);
  assert.equal(state.black.finalBattleAdded, 1);
  assert.equal(state.result, null);
  assert.equal(state.black.discard.filter((card) => card === 'final_battle').length, 0);
  state.round = CONFIG.black.finalBattleStartRound + 1;
  state.phase = 'black';
  state.black.deck = [];
  state.black.discard = ['build'];
  state = Engine.advance(state);
  assert.equal(state.black.finalBattleAdded, 2);
});

test('score can be recomputed from board and permanent points, and resources/units remain conserved', () => {
  let state = freshGame();
  const beforeUnits = state.players.reduce((sum, player) => sum + player.units.militia + player.units.guard + player.reserve.militia + player.reserve.guard, 0);
  setControlledTile(state, 'p1', [1, 1]);
  tile(state, [1, 1]).building = 'monument';
  state = Engine.recomputeScores(state);
  const snapshot = Engine.snapshot(state, 'p1');
  assert.equal(snapshot.players.find((p) => p.id === 'p1').score, state.players[0].score);
  const afterUnits = state.players.reduce((sum, player) => sum + player.units.militia + player.units.guard + player.reserve.militia + player.reserve.guard, 0);
  assert.equal(afterUnits, beforeUnits);
  assert.equal(Engine.checkInvariants(state).ok, true);
});

