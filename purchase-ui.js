(function exposePurchaseUI(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PurchaseUI312 = api;
}(typeof window === 'undefined' ? globalThis : window, () => {
  function createPurchaseCommandHandlers({
    actions = [],
    faceUpCards = [],
    faceUpActions = new Map(),
    getSelectedSlot,
    setSelectedSlot,
    clearSelection,
    submitAction,
  }) {
    const selectable = (index) => {
      if (!Number.isInteger(index) || !faceUpCards[index]) return false;
      return faceUpActions.has(faceUpCards[index]);
    };
    return {
      selectSlot(index) {
        if (!selectable(index)) return false;
        setSelectedSlot(getSelectedSlot() === index ? null : index);
        return true;
      },
      confirm() {
        const index = getSelectedSlot();
        if (!selectable(index)) return false;
        clearSelection();
        submitAction({ type: 'purchase_face_up', card: faceUpCards[index] });
        return true;
      },
      random() {
        if (!actions.some((action) => action.type === 'purchase_blind')) return false;
        submitAction({ type: 'purchase_blind' });
        return true;
      },
      pass() {
        if (!actions.some((action) => action.type === 'pass_purchase')) return false;
        clearSelection();
        submitAction({ type: 'pass_purchase' });
        return true;
      },
    };
  }

  return { createPurchaseCommandHandlers };
}));
