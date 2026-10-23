const test = require('node:test');
const assert = require('node:assert/strict');

const { commandPhaseNotices } = require('../phase-notices');

function phase(kind, name) {
  return { kind, phase: name };
}

test('command phase notice precedes automatic notices through the complete combat cycle', () => {
  const automatic = [
    phase('phase', 'black'),
    phase('phase', 'exploration'),
    phase('phase', 'production'),
    phase('production', 'production'),
    phase('phase', 'purchase'),
  ];

  const notices = commandPhaseNotices('action', 'combat', phase('phase', 'combat'), automatic);

  assert.deepEqual(
    notices.map(({ kind, phase: name }) => `${kind}:${name}`),
    [
      'phase:combat',
      'phase:black',
      'phase:exploration',
      'phase:production',
      'production:production',
      'phase:purchase',
    ],
  );
});

test('command phase notice is added for purchase to action before empty automatic settlement', () => {
  const notices = commandPhaseNotices('purchase', 'action', phase('phase', 'action'), []);

  assert.deepEqual(notices, [phase('phase', 'action')]);
});

test('command phase notice is not duplicated when the command stays in the same phase', () => {
  const automatic = [phase('phase', 'black')];

  assert.deepEqual(commandPhaseNotices('purchase', 'purchase', phase('phase', 'purchase'), automatic), automatic);
});
