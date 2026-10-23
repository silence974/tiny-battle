(function exposePhaseNotices(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PhaseNotices312 = api;
}(typeof window === 'undefined' ? globalThis : window, () => {
  function commandPhaseNotices(beforePhase, afterPhase, commandNotice, automaticNotices = []) {
    const automatic = [...automaticNotices];
    return beforePhase === afterPhase ? automatic : [commandNotice, ...automatic];
  }

  return { commandPhaseNotices };
}));
