const CONFIG = {
  id: '312-web',
  phases: ['exploration', 'production', 'purchase', 'action', 'combat', 'black'],
  board: {
    rows: 7,
    cols: 7,
    playerHQ: {
      1: [0, 0],
      2: [0, 6],
      3: [6, 0],
      4: [6, 6],
    },
    blackHQ: [3, 3],
    expansionSteps: {
      1: [[3, 3]],
      2: [[2, 3], [3, 2], [3, 3], [3, 4], [4, 3]],
      3: [[2, 2], [2, 3], [2, 4], [3, 2], [3, 3], [3, 4], [4, 2], [4, 3], [4, 4]],
      4: [[1, 3], [2, 2], [2, 3], [2, 4], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [4, 2], [4, 3], [4, 4], [5, 3]],
      5: [[1, 2], [1, 3], [1, 4], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [5, 2], [5, 3], [5, 4]],
      6: [[0, 3], [1, 2], [1, 3], [1, 4], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [5, 2], [5, 3], [5, 4], [6, 3]],
      7: [[0, 2], [0, 3], [0, 4], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [2, 0], [2, 1], [2, 2], [2, 3], [2, 4], [2, 5], [2, 6], [3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6], [4, 0], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5], [4, 6], [5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [6, 2], [6, 3], [6, 4]],
    },
  },
  start: {
    resources: { gold: 10, wood: 6, food: 2 },
    units: { militia: 2, guard: 2 },
    reserve: { militia: 0, guard: 0 },
    ap: 3,
  },
  units: {
    militia: { power: 1, capacity: 2, recruit: { gold: 2, food: 1 } },
    guard: { power: 2, capacity: 1, recruit: { gold: 2, food: 2 } },
  },
  buildings: {
    farm: {
      buyGold: 2,
      build: { gold: 1, wood: 1, food: 0 },
      production: { resource: 'food', tier2: 2, tier3: 4 },
      points: 1,
    },
    goldmine: {
      buyGold: 2,
      build: { gold: 1, wood: 3, food: 2 },
      production: { resource: 'gold', tier2: 3, tier3: 5 },
      points: 1,
    },
    lumber: {
      buyGold: 2,
      build: { gold: 3, wood: 0, food: 2 },
      production: { resource: 'wood', tier2: 2, tier3: 4 },
      points: 1,
    },
    barracks: {
      buyGold: 2,
      build: { gold: 1, wood: 1, food: 1 },
      production: null,
      points: 0,
    },
    monument: {
      buyGold: 2,
      build: { gold: 6, wood: 4, food: 2 },
      production: null,
      points: 4,
    },
  },
  exploration: {
    swapCostGold: 2,
    eventDeck: [
      { name: 'valley', count: 15, resource: { food: 2 }, monster: { power: 4, points: 1, reward: { food: 1 } } },
      { name: 'woodland', count: 15, resource: { wood: 2 }, monster: { power: 4, points: 1, reward: { wood: 1 } } },
      { name: 'trade_route', count: 12, resource: { gold: 2 }, monster: { power: 5, points: 1, reward: { gold: 1 } } },
      { name: 'ruins', count: 6, resource: { choice: 2 }, monster: { power: 7, points: 2, reward: { choice: 1 } } },
    ],
  },
  purchase: {
    faceUpSlots: 5,
    maxFaceUp: 1,
    maxBlind: 1,
    blindGoldPrice: 2,
    ap: 0,
  },
  movement: {
    freeTiles: 2,
    compensationFoodPerExtraTile: 1,
    compensationMode: 'per_route',
  },
  black: {
    baseDeck: { expansion: 6, build: 18, garrison: 8 },
    drawPerRound: 2,
    finalBattleStartRound: 11,
    finalBattleCount: 4,
    standardPower: 1,
    standardRewardGold: 1,
    expansionAttackPowerBase: 1,
    expansionAttackPowerPerCard: 2,
    hqInitialPower: 17,
    hqPoints: 10,
  },
  rules: {
    hqInvulnerable: true,
    buildRequiresControl: false,
    buildEnemyTiles: false,
    blackExpansionUnknownKeepsEvent: false,
    postBlackEventFailure: 'neutral',
    maxEventsPerTile: 1,
  },
  hqProductionTiers: [
    { minCapacity: 0, maxCapacity: 5, gold: 1, wood: 1, food: 0 },
    { minCapacity: 6, maxCapacity: 999, gold: 3, wood: 2, food: 0 },
  ],
  hqProduction: { gold: 1, wood: 1, food: 0 },
  recruitment: { maxPerAction: 2, requireBarracks: true, requiresStationedUnit: true },
};

if (typeof module !== 'undefined' && module.exports) module.exports = CONFIG;
if (typeof window !== 'undefined') window.CONFIG_312 = CONFIG;
