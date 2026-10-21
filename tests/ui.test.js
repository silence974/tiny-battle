const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('root home page loads browser dependencies before app code and has host/player entry controls', () => {
  const html = read('index.html');
  assert.match(html, /supabase-js/i);
  assert.match(html, /supabase-config\.js/);
  assert.match(html, /engine312\.js/);
  assert.match(html, /supabase-room\.js/);
  assert.match(html, /app\.js/);
  assert.match(html, /id=["']host-mode["']/);
  assert.match(html, /id=["']player-mode["']/);
  assert.match(html, /id=["']room-code["']/);
  assert.match(html, /id=["']seat-links["']/);
  assert.match(html, /debug\.html/);
  assert.doesNotMatch(html, /p2p-vote/);
  assert.ok(html.indexOf('supabase-js') < html.indexOf('app.js'));
});

test('home page exposes phase, board, resources, hand, legal actions, log, and outcome containers', () => {
  const html = read('index.html');
  for (const id of ['phase', 'round', 'sequence', 'board', 'resources', 'hand', 'legal-actions', 'event-log', 'outcome']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
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

