const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('confirmed dispatch route uses one continuous industrial path with explicit nodes and arrow', () => {
  const app = read('app.js');
  const css = read('styles.css');
  const overlay = app.slice(app.indexOf('function renderDispatchRouteOverlay'), app.indexOf('function renderBoard'));

  assert.match(overlay, /dispatch-route-clearance/);
  assert.match(overlay, /dispatch-route-ink/);
  assert.match(overlay, /dispatch-route-signal/);
  assert.match(overlay, /dispatch-route-start/);
  assert.match(overlay, /dispatch-route-bend/);
  assert.match(overlay, /dispatch-route-arrow/);
  assert.doesNotMatch(overlay, /marker-end|createElementNS\([^\n]+, 'marker'\)/);
  assert.match(css, /\.dispatch-route-clearance\s*\{/);
  assert.match(css, /\.dispatch-route-ink\s*\{/);
  assert.match(css, /\.dispatch-route-signal\s*\{/);
});
