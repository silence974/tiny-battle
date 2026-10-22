const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('root home page loads browser dependencies before app code and preserves the original entry controls', () => {
  const html = read('index.html');
  assert.match(html, /supabase-js/i);
  assert.match(html, /supabase-config\.js/);
  assert.match(html, /engine312\.js/);
  assert.match(html, /supabase-room\.js/);
  assert.match(html, /app\.js/);
  assert.match(html, /id=["']create-room["']/);
  assert.match(html, /创建房间|创建对局/);
  assert.match(html, /id=["']quick-simulate["']/);
  assert.match(html, /快速模拟/);
  assert.match(html, /id=["']player-count["']/);
  assert.match(html, /对局人数/);
  assert.doesNotMatch(html, /id=["']player-link["']/);
  assert.doesNotMatch(html, /id=["']join-room["']/);
  assert.match(html, /id=["']room-code["']/);
  assert.match(html, /id=["']seat-links["']/);
  assert.match(html, /debug\.html/);
  assert.doesNotMatch(html, /p2p-vote/);
  assert.ok(html.indexOf('supabase-js') < html.indexOf('app.js'));
});

test('seat links are opened as automatic join links and browser boot handles them', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /id=["']player-panel["']/);
  assert.match(html, /自动加入|自动入座/);
  assert.match(app, /function readSeatLink\(url = location\.href\)/);
  assert.match(app, /startPlayer\(\)/);
  assert.match(app, /state\.mode === 'player'/);
  assert.doesNotMatch(app, /\$\('player-link'\)/);
});

test('quick simulation keeps the 312 four-seat rule explicit', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /id=["']player-count["'][^>]*type=["']number["']/);
  assert.match(html, /value=["']4["']/);
  assert.match(html, /id=["']player-count["'][^>]*readonly/);
  assert.match(html, /规则锁定四个席位/);
  assert.match(app, /function startQuickSimulation/);
  assert.match(app, /function runQuickSimulation/);
  assert.match(app, /purchase_face_up/);
  assert.match(app, /type === 'build'/);
  assert.match(app, /type === 'dispatch'/);
  assert.match(app, /Room\.PLAYER_COUNT/);
  assert.match(app, /state\.mode === 'simulation'/);
});

test('home page exposes phase, board, resources, hand, legal actions, log, and outcome containers', () => {
  const html = read('index.html');
  for (const id of ['phase', 'round', 'sequence', 'board', 'resources', 'hand', 'legal-actions', 'event-log', 'outcome']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
});

test('host view is lobby-and-log only and auto-advances non-decision phases', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /id=["']host-log["']/);
  assert.doesNotMatch(html, /id=["']advance-phase["']/);
  assert.match(app, /function renderHostLog/);
  assert.match(app, /function settleHostAutomatic/);
  assert.match(app, /settleHostAutomatic\(\)/);
  assert.match(app, /renderRoster\(\[\.\.\.state\.roomState\.players\.values\(\)\]/);
  assert.match(app, /state\.mode === 'host'/);
});

test('host keeps the game in the lobby until all four seats are ready', () => {
  const app = read('app.js');
  assert.match(app, /started: false/);
  assert.match(app, /function startGameAfterAllSeats/);
  assert.match(app, /state\.roomState\.players\.size !== Room\.PLAYER_COUNT/);
  assert.match(app, /等待四席入座/);
  assert.match(app, /if \(!state\.started\) return/);
});

test('tile inspector keeps the clean overlay content contract', () => {
  const app = read('app.js');
  assert.doesNotMatch(app, /summary\.className = 'detail-list'/);
  assert.match(app, /copy\.replaceChildren\(tierPanel, forcesPanel\)/);
});

test('board tiles are square and expose an accessible snapshot detail inspector', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(html, /id=["']tile-inspector["']/);
  assert.match(html, /id=["']tile-inspector-preview["']/);
  assert.match(app, /function showTileDetail/);
  assert.match(app, /role["'], ["']button/);
  assert.match(app, /tile-inspector/);
  assert.match(css, /\.tile\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
  assert.match(css, /\.tile-inspector-preview\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
});

test('hand cards and building details expose rule-driven tiers, score, costs, and stationed units', () => {
  const app = read('app.js');
  const config = read('config-312.js');
  const css = read('styles.css');
  assert.match(app, /function renderCardDetail/);
  assert.match(app, /function productionTierForTile/);
  assert.match(app, /function currentProductionForTile/);
  assert.match(app, /tileProductionLabel\(currentProduction\)/);
  assert.doesNotMatch(app, /const production = tile\.production/);
  assert.doesNotMatch(app, /tileProductionLabel\(production\)/);
  assert.match(app, /tile-inspector-tier/);
  assert.match(app, /tile-inspector-forces/);
  assert.match(config, /tier3: 5/);
  assert.match(css, /\.card-chip-header/);
  assert.match(css, /\.production-tier\.is-active/);
});

test('player phase guidance is a live vertical step bar with current action hints', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(html, /class=["']phase-steps["']/);
  assert.match(html, /data-phase=["']purchase["']/);
  assert.match(html, /id=["']phase-guidance["']/);
  assert.match(app, /function renderPhaseGuide/);
  assert.match(app, /snapshot\.legalActions/);
  assert.match(css, /\.phase-step\.is-current/);
});

test('four seats use distinct colors across map, overview, and cards', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  for (const seat of [1, 2, 3, 4]) {
    assert.match(css, new RegExp(`--seat-p${seat}:`));
    assert.match(css, new RegExp(`\.tile\.owner-p${seat}`));
    assert.match(app, new RegExp(`seat-color-p\\$\\{seat\\}`));
  }
  assert.match(html, /legend-p1/);
  assert.match(html, /legend-p4/);
});

test('home page provides the unified game shell and information hierarchy', () => {
  const html = read('index.html');
  for (const id of ['phase-rail', 'player-overview', 'resource-strip', 'hand-panel', 'action-panel', 'event-panel']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /class=["'][^"']*app-shell/);
  assert.match(html, /class=["'][^"']*board-card/);
  assert.match(read('app.js'), /dataset\.actionType/);
});

test('home page exposes dynamic resource and board legends instead of sketch-only copy', () => {
  const html = read('index.html');
  assert.match(html, /id=["']resource-gold["']/);
  assert.match(html, /id=["']resource-wood["']/);
  assert.match(html, /id=["']resource-food["']/);
  assert.match(html, /id=["']board-legend["']/);
  assert.match(html, /id=["']current-player["']/);
  assert.doesNotMatch(html, /黑总部 15/);
});

test('app renderer formats live resource cards and readable action labels', () => {
  const app = read('app.js');
  assert.match(app, /function renderResourceStrip/);
  assert.match(app, /function actionLabel/);
  assert.match(app, /`resource-\$\{resource\}`/);
  assert.match(app, /dataset\.actionType/);
  assert.match(app, /snapshot\.players/);
});

test('unified stylesheet defines the light board layout and responsive panels', () => {
  const css = read('styles.css');
  assert.match(css, /--color-primary/);
  assert.match(css, /\.app-shell/);
  assert.match(css, /\.board-card/);
  assert.match(css, /@media/);
  assert.match(css, /\.phase-rail/);
});

test('approved tactical-console visual language is present without changing gameplay hooks', () => {
  const html = read('index.html');
  const css = read('styles.css');
  assert.match(html, /data-ef-accent=["']yellow["']/);
  assert.match(html, /data-ef-paper=["']neutral["']/);
  assert.match(html, /data-ef-cut=["']tight["']/);
  assert.match(html, /data-ef-ground=["']grid["']/);
  assert.match(html, /data-ef-density=["']compact["']/);
  assert.match(html, /data-ef-motion=["']calm["']/);
  assert.match(html, /class=["'][^"']*signal-strip/);
  assert.match(css, /--ef-signal:\s*#fffa00/i);
  assert.match(css, /\.card\s*\{[^}]*border-radius:\s*0[^}]*box-shadow:\s*none/s);
  assert.match(css, /\.primary-button\s*\{[^}]*clip-path:\s*polygon/s);
  assert.match(css, /\.topbar\s*\{[^}]*background:\s*var\(--ef-command\)/s);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

test('tile detail is a non-disruptive overlay instead of a grid participant', () => {
  const css = read('styles.css');
  assert.match(css, /\.tile-inspector\s*\{[^}]*position:\s*fixed[^}]*z-index:/s);
  assert.match(css, /\.tile-inspector\s*\{[^}]*inset:/s);
  assert.match(css, /\.tile-inspector-layout\s*\{[^}]*max-height:/s);
});

test('host debug page contains four private perspective panels and seat-link controls', () => {
  const html = read('debug.html');
  assert.match(html, /host-only|host/i);
  assert.match(html, /id=["']debug-seats["']/);
  assert.equal((html.match(/class=["'][^"']*seat-panel/g) || []).length >= 4, true);
  assert.match(html, /generate-seat-link|copy-seat-link/);
  assert.doesNotMatch(html, /p2p-vote/);
});

test('browser scripts pass syntax checks and debug page is self-contained', () => {
  for (const file of ['app.js', 'debug.js', 'engine312.js', 'config-312.js', 'supabase-room.js', 'agent-client.js']) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`);
  }
  assert.match(read('debug.html'), /debug\.js/);
  assert.match(read('app.js'), /player\.engineId/);
  assert.match(read('app.js'), /Room\.enginePlayerId/);
});

test('browser reconnect identity is persisted per room and seat', () => {
  const app = read('app.js');
  assert.match(app, /localStorage/);
  assert.match(app, /seat-\$\{seat\.seat\}/);
  assert.match(app, /async function onLeave/);
  assert.match(app, /pagehide/);
});

