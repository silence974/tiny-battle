const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('empty and black tiles use terrain titles instead of owner ids', () => {
  const app = read('app.js');
  const title = app.slice(app.indexOf('function tileInspectorTitle'), app.indexOf('function tileInspectorPoints'));
  assert.match(title, /tile\.kind === 'land'.*'空地'/s);
  assert.match(title, /tile\.kind === 'black'.*'黑色区域'/s);
  assert.doesNotMatch(title, /tileOwnerLabel\(tile\)/);
});

test('each populated force row owns one borderless control pair aligned outside the card', () => {
  const app = read('app.js');
  const css = read('styles.css');
  const detail = app.slice(app.indexOf('function showTileDetail'), app.indexOf('function showCardDetail'));
  assert.match(detail, /Object\.entries\(group\.forces \|\| \{\}\)\.filter\(\(\[, count\]\) => Number\(count\) > 0\)/);
  assert.doesNotMatch(detail, /force-detail-group-controls/);
  assert.match(detail, /line\.append\(copy, quantity, controls\)/);
  assert.match(css, /\.force-detail-line\s*\{[^}]*position:\s*relative/s);
  assert.match(css, /\.force-detail-controls\s*\{[^}]*top:\s*50%[^}]*left:\s*calc\(100% \+ \.3rem\)[^}]*translateY\(-50%\)/s);
  assert.doesNotMatch(css, /\.force-detail-controls\s*\{[^}]*border:/s);
});

test('force group class names match the colored player label selectors', () => {
  const app = read('app.js');
  const css = read('styles.css');
  const groupClass = app.slice(app.indexOf('function forceGroupClass'), app.indexOf('function tileProductionLabel'));
  assert.match(groupClass, /return 'force-detail-group-black'/);
  assert.match(groupClass, /`force-detail-group-p\$\{seat\}`/);
  for (const seat of [1, 2, 3, 4]) {
    assert.match(css, new RegExp(`\\.force-detail-group-p${seat}\\s*\\{[^}]*--seat-tint:\\s*var\\(--seat-p${seat}\\)`));
  }
});

test('garrison details use the selected numbered-record layout without altering the card body', () => {
  const css = read('styles.css');
  assert.match(css, /\.tile-inspector-forces\s*\{[^}]*padding:\s*\.35rem\s+0\s+0/s);
  assert.match(css, /\.force-detail-group-body\s*\{[^}]*counter-reset:\s*unit-row[^}]*border-top:\s*6px\s+solid\s+var\(--seat-tint\)/s);
  assert.match(css, /\.force-detail-line\s*\{[^}]*grid-template-columns:\s*24px\s+minmax\(0,\s*1fr\)\s+auto[^}]*counter-increment:\s*unit-row/s);
  assert.match(css, /\.force-detail-line::before\s*\{[^}]*content:\s*"0"\s+counter\(unit-row\)/s);
  assert.match(css, /\.force-detail-group-total\s*\{[^}]*color:\s*#fff[^}]*background:\s*var\(--ef-ink\)/s);
  assert.match(css, /\.force-detail-adjust\s*\{[^}]*border:\s*2px\s+solid\s+var\(--ef-ink\)/s);
  assert.match(css, /\.tile-inspector-head\s*\{[^}]*border-bottom:\s*1px\s+solid\s+var\(--ef-ink\)/s);
  assert.match(css, /\.tile-inspector-tiers::before\s*\{/);
});

test('approved faction palette is defined once for every player surface', () => {
  const css = read('styles.css');
  const approved = [
    ['p1', '#d94a45', '#f9e7e5', '#8b2421'],
    ['p2', '#2d63c8', '#e7eefc', '#1e4388'],
    ['p3', '#2f8a57', '#e5f3ea', '#1f603c'],
    ['p4', '#7650b5', '#eee8f8', '#4d3377'],
  ];
  for (const [seat, accent, tint, ink] of approved) {
    assert.match(css, new RegExp(`--seat-${seat}:\\s*${accent}`));
    assert.match(css, new RegExp(`--seat-${seat}-tint:\\s*${tint}`));
    assert.match(css, new RegExp(`--seat-${seat}-ink:\\s*${ink}`));
  }
});
