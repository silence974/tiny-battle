(function bootDebug() {
  const Room = window.Room312;
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  const room = params.get('r');
  const hostId = params.get('h');
  const channel = room && 'BroadcastChannel' in window ? new BroadcastChannel(`game312-debug:${room}`) : null;
  const seatLinks = new Map();
  const snapshots = new Map();
  const status = document.getElementById('debug-status');
  const error = document.getElementById('debug-error');

  function renderSeat(seat) {
    const snapshot = snapshots.get(seat);
    const panel = document.getElementById(`seat-panel-${seat}`);
    if (!panel || !snapshot) return;
    panel.querySelector('.seat-state').textContent = `阶段 ${snapshot.phase} · 回合 ${snapshot.round} · 序号 ${snapshot.seq}\n${JSON.stringify(snapshot.players.find((player) => player.seat === seat) || {}, null, 2)}`;
    const actions = panel.querySelector('.seat-actions');
    actions.replaceChildren(...(snapshot.legalActions || []).map((action) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = action.type;
      button.addEventListener('click', () => channel?.postMessage({ type: 'debug_action', hostId, seat, seq: snapshot.seq, action }));
      return button;
    }));
  }

  function render(data) {
    if (data.hostId !== hostId) return;
    status.textContent = '主机在线；四席调试视角已连接';
    for (const item of data.seats || []) {
      snapshots.set(item.seat, item.snapshot);
      renderSeat(item.seat);
    }
    for (const link of data.links || []) seatLinks.set(link.seat, link.url);
  }

  document.querySelectorAll('.generate-seat-link').forEach((button) => {
    button.addEventListener('click', async () => {
      const link = seatLinks.get(Number(button.dataset.seat));
      if (!link) { error.textContent = '主机尚未回传座位链接'; return; }
      await navigator.clipboard?.writeText(link);
      error.textContent = `已复制 P${button.dataset.seat} 短链接`;
    });
  });

  if (!channel || !room || !hostId) {
    error.textContent = '只有在线主机可以打开四席调试页，请从游戏主页按钮进入。';
    return;
  }
  channel.onmessage = ({ data }) => {
    if (data.type === 'debug_state') render(data);
    if (data.type === 'debug_error') error.textContent = data.message;
  };
  channel.postMessage({ type: 'debug_hello', room, hostId });
})();
