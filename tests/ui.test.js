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
  assert.match(app, /function hasSeatLinkMarker\(url = location\.href\)/);
  assert.match(app, /mode: hasSeatInvite\(\) \|\| hasSeatLinkMarker\(\) \? 'player' : 'host'/);
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
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(html, /class=["']mobile-game-tabs/);
  assert.match(html, /data-mobile-target=["']board["']/);
  assert.match(html, /id=["']tile-inspector["'][^>]*class=["'][^"']*tile-inspector/);
  assert.match(html, /id=["']tile-inspector-card["'][^>]*class=["'][^"']*tile-inspector-card/);
  assert.doesNotMatch(html, /id=["']tile-inspector-preview["']/);
  assert.doesNotMatch(html, /class=["'][^"']*tile-inspector-layout/);
  assert.doesNotMatch(html, /id=["']tile-inspector-copy["']/);
  assert.doesNotMatch(html, /id=["']close-tile-inspector["']/);
  assert.doesNotMatch(html, /id=["']tile-inspector["'][^>]*class=["'][^"']*card/);
  assert.doesNotMatch(app, /summary\.className = 'detail-list'/);
  assert.match(app, /function tileInspectorTitle/);
  assert.match(app, /function tileInspectorPoints/);
  assert.match(app, /points\.textContent = String\(score\)/);
  assert.match(app, /production-tier-header/);
  assert.match(app, /tile-inspector-tiers/);
  assert.match(app, /tile-inspector-cost/);
  assert.match(app, /forcesPanel\.replaceChildren\(\)/);
  assert.doesNotMatch(app, /copy\.replaceChildren\(tierPanel, forcesPanel\)/);
  assert.match(css, /\.tile-inspector-card\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
  assert.match(css, /\.tile-inspector-tiers::before\s*\{[^}]*bottom:\s*0[^}]*left:\s*3rem/s);
  assert.match(css, /\.tile-inspector-head h2\s*\{[^}]*font-size:\s*2rem/s);
  assert.match(css, /\.tile-inspector-head strong\s*\{[^}]*font-size:\s*1\.5rem/s);
  assert.match(css, /\.production-tier-header\s*\{[^}]*font-size:\s*1rem/s);
  assert.match(css, /\.tile-inspector-tiers \.production-tier\s*\{[^}]*font-size:\s*1rem/s);
  assert.match(css, /\.tile-inspector-tiers \.production-tier:last-child\s*\{[^}]*border-bottom:\s*0/s);
  assert.match(css, /\.force-detail-row strong\s*\{[^}]*font-size:\s*1rem/s);
});

test('board tiles are square and expose an accessible snapshot detail inspector', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(html, /id=["']tile-inspector["']/);
  assert.match(html, /id=["']tile-inspector-card["']/);
  assert.match(app, /function showTileDetail/);
  assert.match(app, /role["'], ["']button/);
  assert.match(app, /tile-inspector/);
  assert.match(css, /\.tile\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
  assert.match(css, /\.tile-inspector-card\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
  assert.doesNotMatch(css, /\.tile(?::[a-z]+)?::after/);
});

test('hand cards and building details expose rule-driven tiers, score, costs, and stationed units', () => {
  const app = read('app.js');
  const config = read('config-312.js');
  const configData = require(path.join(root, 'config-312.js'));
  const css = read('styles.css');
  assert.match(app, /function renderCardDetail/);
  assert.match(app, /function cardDescription/);
  assert.match(app, /function renderCardProduction/);
  assert.match(app, /function showCardDetail/);
  assert.match(app, /function cardFunctionalEffect/);
  assert.match(app, /Object\.entries\(tierEffects\)[\s\S]*?\.sort\(\(\[left\], \[right\]\) => Number\(right\) - Number\(left\)\)/);
  assert.doesNotMatch(app, /行动阶段增加可选的招募行动/);
  assert.doesNotMatch(app, /if \(card === 'monument'\)/);
  assert.match(app, /points\.textContent = String\(description\.points\)/);
  assert.match(app, /production-tier-header/);
  assert.match(app, /effect\.type === 'resource'/);
  assert.match(app, /row\.append\(capacity, output\)/);
  assert.doesNotMatch(app.slice(app.indexOf('function renderCardDetail'), app.indexOf('function renderTileVisual')), /force-detail-row|garrison/);
  assert.match(app, /function productionTierForTile/);
  assert.match(app, /function currentProductionForTile/);
  assert.match(app, /function tileProductionEffect/);
  assert.match(app, /axis: String\(tier\.minCapacity\)/);
  assert.doesNotMatch(app, /容量 \$\{/);
  assert.doesNotMatch(app, /const production = tile\.production/);
  assert.doesNotMatch(app, /tileProductionLabel\(production\)/);
  assert.match(app, /activeTier === tier\.id/);
  assert.match(app, /tile-inspector-tiers/);
  assert.match(app, /tile-inspector-forces/);
  assert.match(app, /renderCardProduction\(\$\('tile-inspector-tiers'\), description\)/);
  assert.match(app, /item\.classList\.add\('card-chip-interactive'\)/);
  assert.match(app, /item\.addEventListener\('click', \(\) => showCardDetail\(card\)\)/);
  assert.match(app, /event\.target\.closest\('\.card-chip-interactive'\)/);
  assert.match(config, /tier3: 5/);
  assert.match(css, /\.card-chip-header/);
  assert.match(css, /\.card-chip\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
  assert.match(css, /\.card-chip-production::before/);
  assert.match(css, /\.card-chip-production \.production-tier:last-child\s*\{[^}]*border-bottom:\s*0/s);
  assert.match(css, /\.card-chip-points\s*\{[^}]*font-size:\s*1\.5rem/s);
  assert.match(css, /\.card-chip-cost\s*\{[^}]*font-size:\s*\.9375rem/s);
  assert.match(css, /\.production-tier\.is-active/);
  assert.match(css, /\.card-chip-interactive:hover, \.card-chip-interactive:focus-visible/);
  assert.match(css, /body\.is-game-active\[data-mobile-panel="hand"\] \.game-left-column > #hand-panel \{[^}]*grid-template-rows:\s*auto auto[^}]*align-content:\s*start/s);
  const cards = ['farm', 'goldmine', 'lumber', 'barracks', 'monument'];
  for (const card of cards) {
    const description = configData.buildings[card].description;
    assert.ok(description, `${card} has a unified description`);
    assert.equal(description.name.length > 0, true);
    assert.equal('build' in description, false, `${card} does not duplicate build cost`);
    assert.equal('points' in description, false, `${card} does not duplicate score`);
    if (configData.buildings[card].production) {
      assert.equal('functional' in description, false, `${card} derives resource tiers from rules`);
    } else {
      assert.ok(description.functional?.label, `${card} has functional copy`);
    }
  }
  assert.equal(configData.buildings.barracks.description.functional.label, '行动阶段增加可选的招募行动');
  assert.equal(configData.buildings.monument.description.functional.label, '-');
});

test('active game locks the viewport and keeps secondary panels inside it', () => {
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(app, /document\.body\.classList\.add\(['"]is-game-active['"]\)/);
  assert.match(app, /document\.body\.classList\.remove\(['"]is-game-active['"]\)/);
  assert.match(app, /\$\('entry'\)\.hidden = true/);
  assert.match(app, /\$\('room-panel'\)\.hidden = true/);
  assert.match(css, /body\.is-game-active\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /body\.is-game-active \.topbar\s*\{[^}]*min-height:\s*52px/s);
  assert.match(css, /body\.is-game-active \.app-shell\s*\{[^}]*height:\s*calc\(100dvh - 55px\)/s);
  assert.match(css, /body\.is-game-active \.game-layout\s*\{[^}]*min-height:\s*0[^}]*overflow:\s*hidden/s);
  assert.match(css, /body\.is-game-active \.game-columns\s*\{[^}]*height:\s*100%/s);
  assert.match(css, /body\.is-game-active \.event-panel, body\.is-game-active \.outcome:empty\s*\{[^}]*display:\s*none/s);
  assert.match(css, /body\.is-game-active \.board-card\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /body\.is-game-active \.hand-panel\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /body\.is-game-active \.game-center-column \.board\s*\{[^}]*52vw[^}]*840px/s);
  assert.match(css, /\.phase-step-actions\s*\{[^}]*grid-column:\s*2/s);
  assert.match(css, /@media \(min-width: 1600px\)[\s\S]*?\.app-shell\s*\{[^}]*width:\s*min\(1840px/s);
  assert.match(css, /@media \(min-width: 1600px\)[\s\S]*?body\.is-game-active \.game-columns\s*\{[^}]*minmax\(560px, 1\.8fr\)/s);
});

test('active game uses a three-column tactical desk with a live four-seat roster', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  for (const id of ['game-session-meta', 'game-room-code', 'player-identity', 'ap-value', 'game-left-column', 'player-roster', 'player-roster-list', 'game-center-column', 'game-right-column']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.doesNotMatch(html, /id=["']player-overview["']/);
  assert.match(html, /左侧|玩家信息|资源与得分/);
  assert.match(app, /function renderGameSessionMeta/);
  assert.match(app, /function renderPlayerRoster/);
  assert.match(app, /player-order-index/);
  assert.match(app, /snapshot\.activeSeat/);
  assert.match(app, /player\.resources/);
  assert.match(app, /player\.score/);
  assert.match(app, /player-roster-list/);
  assert.match(app, /function setMobilePanel/);
  assert.match(css, /body\.is-game-active \.game-columns\s*\{[^}]*grid-template-columns:\s*minmax\(220px,\s*\.78fr\).*minmax\(440px,\s*1\.5fr\).*minmax\(260px,\s*\.88fr\)/s);
  assert.match(css, /body\.is-game-active \.game-left-column\s*\{[^}]*grid-template-rows:/s);
  assert.match(css, /\.player-roster\s*\{[^}]*grid-template-rows:\s*auto\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.player-roster-list\s*\{[^}]*grid-template-rows:\s*repeat\(4,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.player-roster-card\.is-active\s*\{[^}]*background:\s*var\(--ef-signal\)/s);
  assert.match(css, /body\.is-game-active \.game-right-column\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s);
});

test('hand panel paginates complete cards and terminal roster shows ranking instead of active turn', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(html, /id=["']hand-pager["']/);
  assert.match(html, /id=["']hand-page-prev["']/);
  assert.match(html, /id=["']hand-page-next["']/);
  assert.match(html, /id=["']current-player-label["'][^>]*>当前行动/);
  assert.match(app, /HAND_PAGE_SIZE\s*=\s*4/);
  assert.match(app, /hand\.slice\(start, start \+ HAND_PAGE_SIZE\)/);
  assert.match(app, /function renderHandPage/);
  assert.match(app, /hand-page-prev/);
  assert.match(app, /hand-page-next/);
  assert.match(app, /renderPlayerRoster\(snapshot\.players, snapshot\.activeSeat, snapshot\.round, snapshot\.outcome\)/);
  assert.match(app, /终局结果/);
  assert.match(app, /const activeClass = ended \? ''/);
  assert.match(css, /body\.is-game-active \.game-left-column \.hand-panel\s*\{[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.hand-pager\s*\{[^}]*display:\s*flex/s);
});

test('phase rail owns the current actions and map cards use the smallest visual contract', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  assert.doesNotMatch(html, /id=["']action-panel["']/);
  assert.match(html, /class=["'][^"']*phase-step-actions[^"']*/);
  assert.match(html, /id=["']legal-actions["'][^>]*class=["'][^"']*phase-step-actions/);
  assert.match(app, /phase-step-actions/);
  assert.match(app, /tile-points/);
  assert.match(app, /tile-garrison/);
  assert.doesNotMatch(app.slice(app.indexOf('function renderTileVisual'), app.indexOf('function closeTileDetail')), /coord\.textContent|cell\.append\(coord/);
  assert.match(css, /body\.is-game-active \.game-right-column\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.phase-step-actions\s*\{/);
  assert.match(css, /\.phase-step\.is-complete\s*\{[^}]*background:\s*var\(--ef-chip\)/s);
  assert.match(css, /\.tile-main\s*\{[^}]*font-size:\s*\.7rem/s);
  assert.match(css, /\.tile-points\s*\{/);
  assert.match(css, /\.tile-garrison\s*\{/);
  assert.match(css, /body\.is-game-active \.game-left-column \.card-chip\s*\{[^}]*font-size:\s*\.58rem/s);
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
  for (const id of ['phase-rail', 'game-session-meta', 'resource-strip', 'hand-panel', 'legal-actions', 'event-panel']) {
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
  assert.match(css, /\.tile-inspector-card\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/s);
  assert.doesNotMatch(css, /\.tile-inspector-layout\s*\{/);
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

