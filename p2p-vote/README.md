# MESH / VOTE

一个四人浏览器端 WebRTC 网状投票原型。GitHub Pages 托管静态页面，Supabase Realtime 只负责房间和 WebRTC 建连信令；游戏规则、投票状态和投票结果都在玩家浏览器中计算。

## 架构与边界

- 房主是非投票的协调节点，不占四个玩家席位。
- 房主创建房间后先设置四个席位昵称（默认 A、B、C、D），再生成四条一次性席位链接。
- 每条链接绑定一个固定席位、昵称和邀请 token；载荷通过 `?join=...` 查询参数传递（旧版 `#join=...` 仍兼容），玩家点击链接即可自动入座，不再输入房间码或玩家名。
- Supabase Broadcast 交换 `join`、`offer`、`answer`、`leave` 等建连信令。
- 主机连接建立后，玩家之间通过 WebRTC DataChannel 建立直连；投票事件不经过 Supabase。
- 当前版本不保存房间、不支持刷新恢复、不支持房主迁移，也没有 TURN 中继。
- 玩家看到 `玩家直连 3/3 · 可关闭主机` 前，房主不要关闭页面。

## Supabase 配置

### 1. 创建项目

在 Supabase 创建一个项目。Free 计划足够当前四人测试规模。

### 2. 开启匿名登录

打开：`Authentication → Providers → Anonymous sign-ins`，启用 Anonymous sign-ins。

客户端会调用 `signInAnonymously()`；如果没有开启，页面会显示明确的鉴权错误。

### 3. 只允许 private Realtime channel

在 Realtime 设置中关闭 **Allow public access to channels**，然后在 SQL Editor 执行：

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

这两个策略只允许已登录客户端读写 Broadcast 消息；客户端仍会以
`config: { private: true }` 加入房间。当前 MVP 使用高熵房间标识和链接内 token
作为房间定位与入座凭据；它们不是独立的持久化授权系统。后续若需要撤销链接或严格的
房间成员权限，应增加房间表和成员 RLS。

### 4. 填写浏览器公开配置

从 Supabase 项目设置中复制 Project URL 和 publishable key，编辑
`supabase-config.js`：

```js
window.SUPABASE_CONFIG = {
  url: 'https://你的项目.supabase.co',
  publishableKey: 'sb_publishable_你的公开key',
};
```

如果文件不存在，可先复制模板：

```bash
cp supabase-config.example.js supabase-config.js
```

publishable key（旧项目可能仍显示 anon key）可以出现在浏览器代码中；
绝对不要把 `secret` 或 `service_role` key 写入这个文件、提交到 GitHub 或发给玩家。

## GitHub Pages 发布

1. 将仓库推送到 GitHub。
2. 打开仓库 `Settings → Pages`。
3. 选择 `Deploy from a branch`、分支 `main`、目录 `/ (root)`。
4. 发布地址通常是：
   `https://silence974.github.io/tiny-battle/p2p-vote/`
5. 首次发布后用浏览器打开该地址，确认页面不再提示填写配置。

## 本地运行

在仓库根目录运行静态服务器：

```bash
python3 -m http.server 8080
```

浏览器打开 `http://localhost:8080/p2p-vote/`。不要直接双击 HTML 文件，
否则模块、WebRTC 和 Supabase 的行为可能与正式静态站点不同。

## 一局游戏流程

1. 房主点击“创建房间”。
2. 房主在生成链接前设置四个席位昵称；留空的席位使用 A、B、C、D 默认名。
3. 房主点击“生成 4 个玩家链接”，分别把四条链接发给四位玩家；生成后昵称和席位不能再修改。
4. 玩家点击收到的链接，页面从链接读取固定席位并自动加入；同一席位重复使用或篡改链接会被拒绝。
5. 房主等待四位玩家连接；玩家看到直连完成后，房主可以关闭。
6. 四位玩家分别选择 A 或 B；所有浏览器收到相同事件并独立计算结果。

## 故障排查

- **提示编辑 `supabase-config.js`**：URL 或 publishable key 为空、格式错误，或配置脚本未部署。
- **Supabase 匿名登录失败**：检查 Authentication 中是否启用了 Anonymous sign-ins。
- **private channel / RLS 错误**：确认已关闭 public channel access，并创建了上面的 `select` 与 `insert` 策略。
- **邀请链接无效**：请从房主重新获取对应席位的完整链接；不要手动修改链接片段。
- **席位已被占用**：每条链接只能成功占用对应席位一次；请使用另一条未使用的席位链接。
- **一直等待房主**：房主必须先创建房间、生成链接且保持页面打开；当前版本不支持刷新后恢复。
- **浏览器页面能打开但直连失败**：当前没有 STUN/TURN，跨家庭网络不保证成功；正式公网服务需要配置 TURN。
- **房主离开后不能恢复**：这是当前 MVP 的明确边界，不是持久化房间服务。

## 测试

```bash
node --test p2p-vote/*.test.js
node --check p2p-vote/game.js
node --check p2p-vote/signaling.js
node --check p2p-vote/app.js
```
