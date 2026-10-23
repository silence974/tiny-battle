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
