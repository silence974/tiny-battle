const test = require('node:test');
const assert = require('node:assert/strict');
const { createPurchaseCommandHandlers } = require('../purchase-ui.js');

test('purchase UI keeps selection local and submits only confirmed or immediate commands', () => {
  const commands = [];
  let selectedSlot = null;
  const handlers = createPurchaseCommandHandlers({
    actions: [
      { type: 'purchase_face_up', card: 'farm' },
      { type: 'purchase_blind' },
      { type: 'pass_purchase' },
    ],
    faceUpCards: ['farm', 'farm', 'monument'],
    faceUpActions: new Map([['farm', { type: 'purchase_face_up', card: 'farm' }]]),
    getSelectedSlot: () => selectedSlot,
    setSelectedSlot: (slot) => { selectedSlot = slot; },
    clearSelection: () => { selectedSlot = null; },
    submitAction: (action) => { commands.push(action); },
  });

  handlers.selectSlot(1);
  assert.deepEqual(commands, [], 'card selection must not submit a command');
  assert.equal(selectedSlot, 1);
  handlers.confirm();
  assert.deepEqual(commands, [{ type: 'purchase_face_up', card: 'farm' }]);
  assert.equal(selectedSlot, null);

  handlers.random();
  handlers.pass();
  assert.deepEqual(commands, [
    { type: 'purchase_face_up', card: 'farm' },
    { type: 'purchase_blind' },
    { type: 'pass_purchase' },
  ]);
  assert.equal(selectedSlot, null);
});
