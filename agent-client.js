const Room = typeof require === 'function' ? require('./supabase-room') : window.Room312;

function createAgentClient({ transport, link, clientId, name }) {
  let details;
  let latest = null;
  function readLink() {
    if (!details) details = Room.parseSeatFragment(new URL(link).hash);
    return details;
  }
  async function join() {
    const seat = readLink();
    if (!transport || typeof transport.join !== 'function') throw new Error('agent transport is required');
    return transport.join({ ...seat, clientId, name });
  }
  async function snapshot() {
    if (!transport || typeof transport.requestSnapshot !== 'function') throw new Error('agent transport cannot request snapshot');
    latest = await transport.requestSnapshot({ clientId, ...readLink() });
    return latest;
  }
  async function legalActions() {
    const state = await snapshot();
    return state.legalActions || [];
  }
  async function act(action) {
    if (!latest) await snapshot();
    return transport.sendCommand({ clientId, ...readLink(), seq: latest.seq, action });
  }
  async function leave() {
    if (transport && typeof transport.leave === 'function') return transport.leave({ clientId, ...readLink() });
    return undefined;
  }
  return { join, snapshot, legalActions, act, leave };
}

const AGENT_API = { createAgentClient };
if (typeof module !== 'undefined' && module.exports) module.exports = AGENT_API;
if (typeof window !== 'undefined') window.Agent312 = AGENT_API;
