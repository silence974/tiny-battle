# Tiny Battle 312 Web

这是 312 桌游的第一版 Web 引擎：GitHub Pages 托管静态页面，Supabase
Realtime 负责五方房间通信。一方是必须保持在线的主机裁判，另外四方是玩家。
正式规则运行时是根目录的 JavaScript `engine312.js`，Python 只用于规则参考和离线验证。

## 根目录入口

- `index.html`：主机创建房间或从座位短链接加入。
- `debug.html`：主机打开的四席视角调试页，可同时查看和操作 P1–P4。
- `engine312.js` / `config-312.js`：纯 Web 312 规则引擎和候选 312 配置。
- `supabase-room.js`：匿名登录、private Realtime、固定席位链接、命令/快照协议。
- `agent-client.js` / `agent-example.js`：本地 Agent 的结构化低 token 接入。
- `p2p-vote/`：历史投票原型，本版本不修改也不作为 312 入口。

## 规则与胜负

回合顺序是：探索 → 同时产出 → 购牌 → P1 到 P4 轮流各执行一个行动，循环至各自
3 AP 用完或 pass → 同时战斗和统一驱逐安置 → 黑方两张行动牌。

占领黑色总部是玩家方完全胜利；黑方行动牌强制终结且总部仍在则玩家方失败。两种
结果都独立计算个人排名，排序为：总分 → 剩余金币 → 控制的非总部地块数；三项相同并列。

主机主页和四席调试页会生成相同的短座位链接。链接只包含房间、固定席位和凭据，放在
URL fragment 中，不编码棋盘快照或日志。真人浏览器和本地 Agent 使用同一个席位链接。

## Supabase 配置

1. 创建 Supabase 项目。
2. 在 `Authentication → Providers` 开启 Anonymous sign-ins。
3. 开启 private Realtime channel，并为已认证用户允许 Broadcast：

```sql
create policy "authenticated clients can receive broadcasts"
on realtime.messages
for select
to authenticated
using (extension = 'broadcast');

create policy "authenticated clients can send broadcasts"
on realtime.messages
for insert
to authenticated
with check (extension = 'broadcast');
```

4. 编辑根目录 `supabase-config.js`：

```js
window.SUPABASE_CONFIG = {
  url: 'https://你的项目.supabase.co',
  publishableKey: 'sb_publishable_你的公开key',
};
```

只能使用 publishable/anon key。禁止把 `secret` 或 `service_role` key 放入静态页面、
提交到 GitHub 或发送给玩家。房间码和席位链接是定位/入座凭据，不是持久化授权系统。

## GitHub Pages 和本地运行

GitHub Pages 应选择 `main` 分支的根目录 `/ (root)`。本地从仓库根目录运行：

```bash
python3 -m http.server 8080
```

然后打开 `http://localhost:8080/`。不要直接双击 HTML 文件。

## 真人 + Agent 流程

主机创建房间后生成四条固定席位短链接。每条链接只能占对应席位；同一身份刷新可重连，
不同身份抢占同一席位会被拒绝。普通玩家/Agent 只能看到自己席位的私有状态；主机打开
右上角“四席视角 / 调试”后，才可同时查看和操作四席。

本地 Agent 使用 Node 依赖，不依赖浏览器 CDN。`--client`/`AGENT_CLIENT_ID` 必须是该席位
稳定不变的身份；不要退回到每次启动都变化的进程号，否则重启时会被主机视为新身份。Agent
正常退出会发送 leave 并释放席位，浏览器刷新也会复用对应房间/席位的本地身份：

```bash
npm install
npm run agent:step -- \
  --link 'https://example.github.io/tiny-battle/#r=ROOM&s=2&t=TOKEN' \
  --client agent-p2 --name 'Agent P2' \
  --url 'https://你的项目.supabase.co' \
  --key 'sb_publishable_你的公开key'

npm run agent:act -- \
  --link 'https://example.github.io/tiny-battle/#r=ROOM&s=2&t=TOKEN' \
  --client agent-p2 --action '{"type":"pass"}' \
  --url 'https://你的项目.supabase.co' \
  --key 'sb_publishable_你的公开key'
```

`agent:step` 返回当前序号、阶段和合法行动的 JSON；`agent:act` 只提交一个结构化行动。
同一席位的真人和 Agent 同时提交时，主机按序号只接受一个，另一个收到明确的
`sequence-conflict`，不会悄悄执行两次。

## 当前边界

- 主机是唯一裁判，必须保持在线；主机刷新或离开后本局不能恢复。
- 尚未实现 Supabase Postgres 持久化、主机迁移、Edge Function 服务端裁判或 TURN。
- 四席实时联机的真实冒烟需要可用的 Supabase URL、公开 key、Anonymous Auth 和 private
  Realtime policy；没有这些外部配置时，只能验证本地规则/协议/静态页面，不能宣称联机已验证。

## 验证

```bash
node --test tests/*.test.js p2p-vote/*.test.js
node --check engine312.js
node --check config-312.js
node --check supabase-room.js
node --check agent-client.js
node --check agent-example.js
node --check app.js
node --check debug.js
```
