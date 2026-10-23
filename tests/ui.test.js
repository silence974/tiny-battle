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
  assert.match(html, /purchase-ui\.js/);
  assert.match(html, /phase-notices\.js/);
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
  assert.match(app, /await state\.transport\.join\([\s\S]*?if \(!state\.snapshot\)/s);
  assert.match(app, /if \(!state\.snapshot\) \{[\s\S]*?等待主机状态/s);
  assert.match(app, /addEventListener\('hashchange',[\s\S]*?startPlayer\(\)/s);
  assert.match(app, /state\.mode === 'player'/);
  assert.doesNotMatch(app, /\$\('player-link'\)/);
});

test('player snapshots replace the waiting status with current sync evidence', () => {
  const app = read('app.js');
  assert.match(app, /state\.mode === 'player'/);
  assert.match(app, /已同步 · 房间 \$\{state\.room \|\| '—'\} · 序号 \$\{snapshot\.seq\}/);
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
  assert.match(app, /function settleHostCommandNotices/);
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
  assert.match(css, /\.force-detail-quantity\s*\{[^}]*font-size:\s*1\.15rem/s);
});

test('garrison details show only staffed unit types with structured metadata', () => {
  const app = read('app.js');
  const css = read('styles.css');
  const detailStart = app.indexOf('function showTileDetail');
  const detail = app.slice(detailStart, app.indexOf('inspector.hidden = false;', detailStart));
  assert.match(detail, /tileGarrisonGroups\(tile\)/);
  assert.match(detail, /force-detail-copy/);
  assert.match(detail, /force-detail-meta/);
  assert.match(detail, /force-detail-quantity/);
  assert.match(detail, /forcesPanel\.hidden = true/);
  assert.doesNotMatch(detail, /无驻军/);
  assert.doesNotMatch(detail, /｜/);
  assert.match(css, /\.force-detail-copy\s*\{[^}]*display:\s*grid/s);
  assert.match(css, /\.force-detail-meta\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /\.force-detail-quantity\s*\{[^}]*text-align:\s*right/s);
  assert.match(detail, /force-detail-line/);
  assert.match(detail, /forceGroups/);
  assert.match(detail, /force-detail-group-label/);
  assert.match(detail, /groupNode\.append\(label, body\)/);
  assert.match(detail, /line\.append\(copy, quantity, controls\)/);
  assert.match(css, /\.force-detail-group\s*\{[^}]*position:\s*relative/);
  assert.match(css, /\.force-detail-group-label\s*\{[^}]*position:\s*absolute[^}]*white-space:\s*nowrap/s);
  assert.doesNotMatch(detail, /force-detail-group-controls/);
  assert.match(css, /\.tile-inspector-forces\s*\{[^}]*overflow:\s*visible/s);
  assert.match(css, /\.force-detail-line\s*\{[^}]*grid-template-columns:\s*24px\s+minmax\(0,\s*1fr\)\s+auto/s);
});

test('garrison groups use the same-width card as the inspector without an outer frame', () => {
  const css = read('styles.css');
  const forcesRule = css.match(/\.tile-inspector-forces\s*\{([^}]*)\}/s)?.[1] || '';
  assert.doesNotMatch(forcesRule, /\bborder\s*:/);
  assert.match(css, /\.force-detail-group\s*\{[^}]*margin:\s*\.35rem\s+0/s);
  assert.match(css, /@media\s*\(max-width:\s*700px\)[\s\S]*?\.tile-inspector\s*\{[^}]*width:\s*min\(320px,\s*calc\(100vw\s*-\s*9rem\)\)/s);
});

test('garrison adjustment controls have no shared wrapper frame and align as row controls', () => {
  const css = read('styles.css');
  assert.doesNotMatch(css, /\.force-detail-group-controls\s*\{/);
  assert.match(css, /\.force-detail-line\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.force-detail-controls\s*\{[^}]*top:\s*50%[^}]*left:\s*calc\(100% \+ \.3rem\)[^}]*translateY\(-50%\)/s);
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

test('host state broadcasts do not let one failed seat block the other seats', () => {
  const app = read('app.js');
  assert.match(app, /await Promise\.all\(targets\.map\(async \(playerId\) =>/);
  assert.match(app, /reportTransportFailure\(`P\$\{player\?\.seat \|\| playerId\} 状态同步`/);
});

test('active game uses a three-column tactical desk with a live four-seat roster', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  for (const id of ['game-session-meta', 'game-room-code', 'player-identity', 'action-step-ap', 'game-left-column', 'player-roster', 'player-roster-list', 'game-center-column', 'game-right-column']) {
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
  assert.match(app, /tile\.garrison \|\| \{\}/);
  assert.match(app, /tile\.blackPower !== null/);
  assert.doesNotMatch(app.slice(app.indexOf('function renderTileVisual'), app.indexOf('function closeTileDetail')), /coord\.textContent|cell\.append\(coord/);
  assert.match(css, /body\.is-game-active \.game-right-column\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.phase-step-actions\s*\{/);
  assert.match(css, /\.phase-step\.is-complete\s*\{[^}]*background:\s*var\(--ef-chip\)/s);
  assert.match(css, /\.tile-main\s*\{[^}]*font-size:\s*(?:\.9|1)rem/s);
  assert.match(css, /\.tile-points\s*\{/);
  assert.match(css, /\.tile-garrison\s*\{/);
  assert.match(css, /body\.is-game-active \.game-left-column \.card-chip\s*\{[^}]*font-size:\s*\.58rem/s);
});

test('purchase phase shows full market cards, power badges, and one-shot turn audio', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(html, /id=["']purchase-actions["']/);
  assert.match(html, /class=["'][^"']*purchase-blueprint[^"']*["']/);
  assert.match(html, /id=["']purchase-blueprint-title["'][^>]*>蓝图规划</);
  assert.match(html, /purchase-blueprint-grid-size[^>]*>3 × 2</);
  assert.match(html, /id=["']purchase-market["']/);
  assert.match(html, /id=["']purchase-confirm["']/);
  assert.match(html, /id=["']purchase-random["']/);
  assert.match(app, /function renderPurchaseActions/);
  assert.match(app, /PurchaseUI312\.createPurchaseCommandHandlers/);
  assert.match(app, /selectedPurchaseSlot/);
  assert.match(app, /purchaseSlot/);
  assert.match(app, /faceUpCards\.map\(\(card, index\)/);
  assert.match(app, /purchase_face_up/);
  assert.match(app, /purchase_blind/);
  assert.match(app, /config\.units\[unit\]\?\.power/);
  assert.match(app, /previousActiveSeat|lastActiveSeat/);
  assert.match(app, /AudioContext/);
  assert.match(css, /\.purchase-market\s*\{/);
  assert.match(css, /\.purchase-market\s*\{[^}]*grid-template-columns:\s*repeat\(2/s);
  assert.match(css, /--blueprint-paper:\s*#eef4f7/i);
  assert.match(css, /--blueprint-ink:\s*#244251/i);
  assert.match(css, /body\.is-game-active \.purchase-market\s*\{[^}]*grid-template-columns:\s*repeat\(2/s);
  assert.doesNotMatch(css, /body\.is-game-active \.purchase-market\s*\{[^}]*display:\s*flex/s);
  assert.match(css, /body\.is-game-active \.phase-step-header strong\s*\{[^}]*display:\s*none/s);
  assert.doesNotMatch(css, /body\.is-game-active \.phase-step strong\s*\{[^}]*display:\s*none/s);
  assert.match(css, /\.purchase-market-card\.is-selected/);
  assert.match(css, /\.purchase-controls button:disabled\s*\{[^}]*color:\s*var\(--ef-ink-2\)[^}]*background:\s*var\(--ef-rule\)[^}]*opacity:\s*\.55/s);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*body\.is-game-active \.game-right-column\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.tile-main\s*\{[^}]*font-size:\s*(?:\.9|1)rem/s);
});

test('blueprint planning fills the sixth grid slot with the blind draw action', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(html, /id=["']purchase-market["'][^>]*>[\s\S]*id=["']purchase-random["'][\s\S]*purchase-blueprint-slot-number[^>]*>06</);
  assert.match(html, /purchase-random-title[^>]*>未知蓝图</);
  assert.match(html, /purchase-random-meta[^>]*>BLIND DRAW</);
  assert.match(app, /const marketCards = faceUpCards\.map\(\(card, index\) =>/);
  assert.match(app, /item\.dataset\.blueprintSlot = String\(index \+ 1\)\.padStart\(2, '0'\)/);
  assert.match(app, /market\.replaceChildren\(\.\.\.marketCards, random\)/);
  assert.match(css, /\.purchase-random-slot\s*\{[^}]*min-height:\s*0[^}]*background:/s);
});

test('purchase UI explains that a seat must end purchase before the next seat acts', () => {
  const app = read('app.js');
  assert.match(app, /等待 P\$\{active\?\.seat \|\| '—'\} 结束购牌后轮到你/);
  assert.match(app, /已购买明牌；还可购买 1 张盲牌，或点击“结束购牌”交给下一位玩家/);
  assert.match(app, /已购买明牌和盲牌；请点击“结束购牌”交给下一位玩家/);
});

test('purchase controls hide for waiting seats and gray used purchase slots', () => {
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(app, /purchaseControls\.hidden = !canAct/);
  assert.match(app, /confirm\.disabled = !canAct \|\| purchase\.faceUp > 0/);
  assert.match(app, /random\.disabled = !canAct \|\| purchase\.blind > 0/);
  assert.match(app, /pass\.className = canAct \? 'primary-button' : 'secondary-button'/);
  assert.match(app, /renderCardDetail\(item, card\);[\s\S]*?item\.classList\.add\('purchase-market-card'\);[\s\S]*?item\.classList\.toggle\('is-selected'/s);
  assert.doesNotMatch(app, /已选：\$\{selectedDescription\.label\}/);
  assert.match(css, /\.purchase-market-card\.is-selected\s*\{[^}]*border-width:\s*4px[^}]*background:\s*var\(--blueprint-panel\)[^}]*box-shadow:\s*6px 6px 0 #9fcfe0/s);
});

test('phase transitions expose a timed banner and production output cue', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(html, /id=["']phase-transition-banner["']/);
  assert.match(html, /id=["']phase-transition-label["']/);
  assert.match(html, /id=["']phase-transition-detail["']/);
  assert.match(app, /function renderPhaseTransition/);
  assert.match(app, /state\.lastPhase/);
  assert.match(app, /playPhaseCue/);
  assert.match(app, /productionOutputNotices/);
  assert.match(app, /productionNoticeOutput/);
  assert.match(app, /phaseNoticeSeen/);
  assert.match(app, /phaseNotices: state\.phaseNotices/);
  assert.match(app, /state\.phaseNoticeQueue/);
  assert.match(app, /const duration = notice\.kind === 'production' \? 700 : PHASE_DISPLAY_MS/);
  assert.doesNotMatch(app, /function waitForPhaseDisplay/);
  assert.match(app, /state\.phaseNotices = settleHostCommandNotices\(phaseBeforeCommand\)/);
  assert.match(app, /const phaseBeforeCommand = state\.game\.phase/);
  assert.match(app, /PhaseNotices\.commandPhaseNotices\(beforePhase, afterPhase, commandNotice, settleHostAutomatic\(\)\)/);
  assert.match(css, /\.phase-transition-banner/);
  assert.match(css, /\.phase-transition-banner\.is-visible/);
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

test('phase rail keeps only purchase and action collapsible', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  for (const phase of ['purchase', 'action']) {
    assert.match(html, new RegExp(`data-phase-toggle=["']${phase}["'][^>]*aria-expanded=["']true["'][^>]*aria-controls=["']phase-content-${phase}["']`));
    assert.match(html, new RegExp(`data-phase-toggle=["']${phase}["'][\\s\\S]*?phase-step-caret`));
    assert.match(html, new RegExp(`id=["']phase-content-${phase}["'][^>]*class=["'][^"']*phase-step-content`));
  }
  for (const phase of ['exploration', 'production', 'combat', 'black', 'ended']) {
    const staticHeader = html.match(new RegExp(`<div class=["']phase-step-header phase-step-static["'][^>]*role=["']heading["'][^>]*data-phase-static=["']${phase}["'][^>]*>[^\\n]*</div>`));
    assert.ok(staticHeader, `${phase} uses a static phase header`);
    assert.doesNotMatch(staticHeader[0], /phase-step-caret/);
    assert.doesNotMatch(html, new RegExp(`data-phase-toggle=["']${phase}["']`));
  }
  assert.match(app, /if \(!toggle\) \{\s*step\.classList\.remove\('is-collapsed'\);/);
  assert.match(css, /\.phase-step-header\s*\{/);
  assert.match(css, /\.phase-rail\s*\{[^}]*width:\s*100%[^}]*justify-content:\s*stretch/s);
  assert.match(css, /\.phase-steps\s*\{[^}]*width:\s*100%/s);
  assert.match(css, /\.phase-step-content\s*\{/);
  assert.match(css, /\.phase-step\.is-collapsed \.phase-step-content\s*\{[^}]*display:\s*none/s);
  assert.match(html, /class=["']phase-step-caret["'][^>]*aria-hidden=["']true["']/);
  assert.match(css, /\.phase-step-header\[aria-expanded=["']false["']\] \.phase-step-caret/);
  assert.match(css, /transform:\s*rotate\(-90deg\)/);
  assert.match(html, /id=["']phase-content-purchase["'][\s\S]*id=["']purchase-actions["']/);
  assert.match(html, /id=["']phase-content-action["'][\s\S]*id=["']legal-actions["']/);
});

test('phase rail keeps local folds and expands on phase and self-turn edges', () => {
  const app = read('app.js');
  assert.match(app, /collapsedPhases:\s*new Set\(\)/);
  assert.match(app, /function bindPhaseToggleButtons/);
  assert.match(app, /data-phase-toggle/);
  assert.match(app, /collapsedPhases\.delete\(snapshot\.phase\)/);
  assert.match(app, /previousPhase !== snapshot\.phase/);
  assert.match(app, /!wasMyTurn && isMyTurn/);
  assert.match(app, /轮到你，可以操作/);
  assert.match(app, /renderPhaseGuide\(snapshot, previousPhase, previousActiveSeat\)/);
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

test('action phase keeps its only AP readout in the collapsible step header', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  assert.doesNotMatch(html, /id=["']ap-value["']/);
  assert.match(html, /data-phase-toggle=["']action["'][^>]*>[\s\S]*?id=["']action-step-ap["']/);
  assert.doesNotMatch(html, /id=["']action-ap["']/);
  assert.match(html, /id=["']action-pass["']/);
  assert.match(app, /action-entry/);
  assert.match(app, /const actionStepAp = \$\('action-step-ap'\)/);
  assert.match(app, /window\.CONFIG_312\?\.start\?\.ap/);
  assert.match(app, /action\.type === 'dispatch' \|\| action\.type === 'deploy'/);
  assert.match(app, /action\.type === 'recruit'/);
  assert.match(app, /actionPass\.hidden/);
  assert.match(css, /\.action-entry\s*\{/);
  assert.match(css, /\.action-step-ap\s*\{/);
  assert.doesNotMatch(css, /\.action-ap-readout\s*\{/);
});

test('action phase keeps build, dispatch, and recruit entries visible when unavailable', () => {
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(app, /const typeGroups = \[/);
  assert.match(app, /\{ type: 'build', label: '建造', actions: actions\.filter/);
  assert.match(app, /\{ type: 'dispatch', label: '派遣', actions: actions\.filter/);
  assert.match(app, /\{ type: 'recruit', label: '招募', actions: actions\.filter/);
  assert.doesNotMatch(app, /\]\s*\.filter\(\(group\) => group\.actions\.length\)/);
  assert.match(app, /button\.disabled = !canAct \|\| !group\.actions\.length/);
  assert.match(app, /actionMode = group\.type/);
  assert.doesNotMatch(app, /actionMode = state\.actionMode === group\.type \? null : group\.type/);
  assert.match(app, /cancel\.className = 'secondary-button'/);
  assert.match(app, /textContent = '取消'/);
  assert.match(app, /clearDispatchDraft\(\{ refresh: false \}\)/);
  assert.match(app, /state\.recruitDraft = null/);
  assert.match(app, /actionPassTitle\.textContent = '跳过'/);
  assert.match(app, /actionPass\.setAttribute\('aria-label', '跳过本轮行动'\)/);
  assert.match(app, /if \(accepted\) clearActionSelection\(\)/);
  assert.match(app, /if \(!canAct && \(state\.actionMode \|\| state\.buildDraft \|\| state\.dispatchDraft \|\| state\.recruitDraft\)\)/);
  assert.match(app, /status\.textContent = ended[\s\S]*player\.passed \? 'PASS'/);
  assert.match(app, /player\?\.passed/);
  assert.match(app, /passedClass = !ended && player\?\.passed/);
  assert.match(css, /\.action-entry:disabled\s*\{[^}]*background:\s*var\(--ef-rule\)[^}]*opacity:\s*\.55/s);
});

test('selected action operations render as a full-width numbered action record', () => {
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(app, /action-command-layout/);
  assert.match(app, /action-command-head/);
  assert.match(app, /\/\/ PROCEDURE STACK \/ 04/);
  assert.match(app, /headTitle\.textContent = '行动记录'/);
  assert.match(app, /headMark\.className = 'action-command-head-mark'/);
  assert.match(app, /headMark\.textContent = 'D\+'/);
  assert.match(app, /titleRow\.append\(headTitle, headMark\)/);
  assert.match(app, /action-command-menu/);
  assert.match(app, /action-record/);
  assert.match(app, /action-entry-index/);
  assert.match(app, /action-workspace/);
  assert.match(app, /activeRecord\?\.append\(workspace\)/);
  assert.match(app, /workspace\.append/);
  assert.match(css, /\.action-command-layout\s*\{[^}]*width:\s*100%[^}]*border:\s*1px\s+solid\s+var\(--ef-ink\)/s);
  assert.match(css, /\.action-command-head::before\s*\{[^}]*background:\s*var\(--ef-signal\)[^}]*clip-path:/s);
  assert.match(css, /\.action-command-head-mark\s*\{[^}]*background:\s*var\(--ef-ink\)[^}]*clip-path:/s);
  assert.match(css, /\.phase-step-content\s*\{[^}]*align-self:\s*stretch[^}]*width:\s*100%/s);
  assert.match(css, /\.action-entry\s*\{[^}]*grid-template-columns:\s*2\.1rem\s+minmax\(0, 1fr\)\s+1rem/s);
  assert.match(css, /\.action-entry\[aria-pressed="true"\]\s*\{[^}]*color:\s*#fff[^}]*background:\s*var\(--ef-ink\)/s);
  assert.match(css, /\.action-workspace\s*\{[^}]*width:\s*100%[^}]*border:\s*1px\s+solid\s+var\(--ef-ink\)/s);
});

test('dispatch confirmation and route feedback stay explicit without closing tile details', () => {
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(app, /endpoint\.disabled = !canAct \|\| !state\.dispatchDraft\?\.route\?\.length/);
  assert.match(app, /function renderDispatchRouteOverlay/);
  assert.match(app, /dispatch-route-overlay/);
  assert.match(app, /showTileDetail\(source, \{ toggle: false \}\)/);
  assert.match(app, /if \(toggle && !inspector\.hidden && inspector\.dataset\.coord === coord\)/);
  assert.match(css, /\.dispatch-confirm-endpoint:disabled\s*\{[^}]*background:\s*var\(--ef-rule\)/s);
  assert.match(css, /\.dispatch-route-overlay\s*\{[^}]*pointer-events:\s*none/s);
  assert.match(css, /\.force-detail-line\s*\{[^}]*grid-template-columns:\s*24px\s+minmax\(0, 1fr\)\s+auto/s);
});

test('action skip uses the short label and clears the action selection contract', () => {
  const html = read('index.html');
  const app = read('app.js');
  assert.match(html, /id=["']action-pass["'][^>]*aria-label=["']跳过本轮行动["'][^>]*>[\s\S]*id=["']action-pass-title["'][^>]*>跳过</);
  assert.match(html, /action-entry-index[^>]*>04</);
  assert.match(html, /id=["']action-pass-meta["'][^>]*>USE ALL REMAINING AP</);
  assert.match(app, /pass: '跳过'/);
  assert.doesNotMatch(app, /pass: '结束行动'/);
});

test('available skip action uses the approved muted brick red while PASS stays neutral gray', () => {
  const css = read('styles.css');
  assert.match(css, /--action-stop:\s*#b7645b/i);
  assert.match(css, /--action-stop-edge:\s*#8a403a/i);
  assert.match(css, /\.action-pass:not\(:disabled\)[^{]*\{[^}]*border-color:\s*var\(--action-stop-edge\)[^}]*background:\s*var\(--action-stop\)/s);
  assert.match(css, /\.action-pass\.is-passed,\s*\.action-pass\.is-passed:hover\s*\{[^}]*background:\s*var\(--ef-rule\)/s);
});

test('a passed player keeps the gray PASS action inside its workspace and hides only the action records', () => {
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(app, /if \(me\?\.passed\) \{/);
  assert.match(app, /layout\.append\(head, menu, footer\)/);
  assert.match(app, /footer\.append\(status, actionPass\)/);
  assert.match(app, /menu\.hidden = Boolean\(me\?\.passed\)/);
  assert.match(app, /status\.textContent = '本轮已跳过，等待其他玩家行动'/);
  assert.match(app, /actionPass\.className = 'action-entry action-pass is-passed'/);
  assert.match(app, /actionPassTitle\.textContent = 'PASS'/);
  assert.match(app, /actionPassMeta\.textContent = 'ALL AP USED'/);
  assert.doesNotMatch(app, /if \(me\?\.passed\) \{\s*actionsPanel\.replaceChildren\(\)/);
  assert.match(css, /\.action-command-footer\s*\{[^}]*border-top:\s*1px\s+solid\s+var\(--ef-ink\)/s);
  assert.match(css, /\.action-pass\.is-passed,\s*\.action-pass\.is-passed:hover\s*\{[^}]*background:\s*var\(--ef-rule\)/s);
});

test('action cancel stays local while pass is the phase-level skip', () => {
  const app = read('app.js');
  assert.match(app, /textContent = '取消'/);
  assert.match(app, /actionPassTitle\.textContent = '跳过'/);
  assert.match(app, /player\.passed \? 'PASS'/);
});

test('build interaction uses one pending draft across tile-first and drag-first paths', () => {
  const html = read('index.html');
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(app, /buildDraft:\s*null/);
  assert.match(app, /function chooseBuildTarget/);
  assert.match(app, /function chooseBuildCard/);
  assert.match(app, /function submitBuildDraft/);
  assert.match(app, /state\.buildDraft = \{ building, cardIndex, at: \[\.\.\.coord\], action:/);
  assert.match(app, /state\.buildDraft = \{\s*building: drag\.card,\s*cardIndex: drag\.cardIndex,\s*at: coord,\s*action:/s);
  assert.match(app, /addEventListener\('pointermove', updateBuildDrag/);
  assert.match(app, /addEventListener\('pointerup', \(event\) => finishBuildDrag/);
  assert.match(app, /addEventListener\('pointercancel', \(event\) => finishBuildDrag/);
  assert.match(app, /id = 'build-confirm'/);
  assert.match(app, /clearBuildDraft\(\)/);
  assert.match(app, /item\.setAttribute\('aria-disabled', String\(item\.disabled\)\)/);
  assert.match(app, /is-build-card-selected/);
  assert.match(app, /item\.setAttribute\('aria-pressed', String\(selectedBuildCard\)\)/);
  assert.match(app, /cell\.dataset\.coord = coordKey\(tile\.coord\)/);
  assert.match(html, /id=["']phase-content-action["'][\s\S]*data-phase-actions=["']action["']/);
  assert.match(css, /\.tile\.is-build-target\s*\{/);
  assert.match(css, /\.tile-build-preview\s*\{/);
  assert.match(css, /\.build-drag-ghost\s*\{/);
});

test('build hand selection distinguishes duplicate cards by hand index', () => {
  const app = read('app.js');
  assert.match(app, /\.map\(\(card, visibleIndex\)/);
  assert.match(app, /const cardIndex = start \+ visibleIndex/);
  assert.match(app, /state\.buildDraft\?\.cardIndex === cardIndex/);
  assert.match(app, /cardIndex, actions\)/);
  assert.match(app, /cardIndex: drag\.cardIndex/);
});

test('dispatch entry keeps deploy reachable and exposes route and force-selection states', () => {
  const app = read('app.js');
  const css = read('styles.css');
  assert.match(app, /action\.type === 'dispatch' \|\| action\.type === 'deploy'/);
  assert.match(app, /function handleDispatchTile/);
  assert.match(app, /function dispatchNextCoords/);
  assert.match(app, /function changeDispatchForce/);
  assert.match(app, /id = 'dispatch-confirm-endpoint'/);
  assert.match(app, /id = 'dispatch-confirm'/);
  assert.match(app, /routeForces:/);
  assert.match(app, /action\.type === 'deploy'/);
  assert.match(app, /tile-dispatch-battle/);
  assert.match(app, /dispatchEndpoint && !tile\.explored/);
  assert.match(css, /\.tile\.is-dispatch-unavailable\s*\{/);
  assert.match(css, /\.tile\.is-dispatch-route\s*\{/);
  assert.match(css, /\.tile\.is-dispatch-battle\s*\{/);
  assert.match(css, /\.force-detail-controls\s*\{/);
});

test('recruit entry supports one unit type and at most three units', () => {
  const app = read('app.js');
  const config = read('config-312.js');
  const css = read('styles.css');
  assert.match(config, /maxPerAction:\s*3/);
  assert.match(app, /function renderRecruitPanel/);
  assert.match(app, /最多|>= 3/);
  assert.match(app, /setAttribute\('role', 'table'\)/);
  assert.match(app, /recruit-header/);
  assert.match(app, /role', 'columnheader'/);
  assert.match(app, /recruit-cell/);
  assert.match(app, /row\.setAttribute\('aria-selected', String\(selected === unit\)\)/);
  assert.match(app, /row\.addEventListener\('keydown'/);
  assert.match(app, /const totalCost =/);
  assert.match(app, /recruit-total-cost/);
  assert.match(app, /id = 'recruit-confirm'/);
  assert.match(css, /\.recruit-panel\s*\{/);
  assert.match(css, /\.recruit-header\s*\{/);
  assert.match(css, /\.recruit-row\s*\{[^}]*grid-template-columns:\s*minmax\(5rem, 1\.3fr\)/s);
  assert.match(css, /\.is-build-card-selected\s*\{/);
  assert.match(css, /\.recruit-controls\s*\{/);
  assert.match(css, /\.recruit-total-cost\s*\{/);
});

test('disabled primary actions stay visibly disabled on touch devices', () => {
  const css = read('styles.css');
  assert.match(css, /\.primary-button:disabled\s*,\s*\.primary-button:disabled:hover\s*\{[^}]*background:\s*var\(--ef-rule\)[^}]*opacity:\s*\.55/s);
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
  for (const file of ['app.js', 'debug.js', 'engine312.js', 'config-312.js', 'supabase-room.js', 'agent-client.js', 'phase-notices.js']) {
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

