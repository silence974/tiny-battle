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
  assert.throws(() => command(stageAction(freshGame()), 'p1', {
    type: 'dispatch', from: [0, 0], to: [0, 1], route: [[0, 1]], forces: { militia: 2, guard: 2 },
  }), /HQ last soldier/);
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
  assert.equal(state.players[0].resources.gold, before - CONFIG.buildings.farm.build.gold + CONFIG.hqProduction.gold);
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
  assert.equal(Engine.outcome(state).ranking.length, 4);
  assert.ok(Engine.outcome(state).ranking[0].score >= Engine.outcome(state).ranking.at(-1).score);
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

