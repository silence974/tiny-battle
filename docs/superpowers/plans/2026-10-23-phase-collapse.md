# 阶段栏折叠交互实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (native implementation in this session).

**Goal:** 为七个阶段栏增加可访问的手动折叠/展开，同时在阶段切换或“非自己→自己”的行动边沿自动展开当前阶段。

**Architecture:** 保持现有阶段栏 DOM、`renderPhaseGuide()` 和阶段操作渲染路径；为每个阶段标题增加按钮并用客户端 `collapsedPhases` 集合控制该阶段实际内容区。阶段状态边沿只在客户端比较上次 snapshot，不进入引擎或服务器协议。

**Tech Stack:** 原生 HTML/CSS/JavaScript，Node `node:test` 静态回归测试。

**Spec:** `docs/superpowers/specs/2026-10-23-phase-collapse-design.md`

## Global Constraints

- 不改变 312 引擎规则、合法动作、阶段通知队列或服务器状态协议。
- 手动折叠只保存在当前浏览器席位；阶段切换和“非自己→自己”边沿必须展开当前阶段。
- 现有 Endfield 风格保持：单一黄色强调色、切角可点击、细线分隔、桌面/手机布局兼容。
- 操作提示播放期间的现有锁定行为必须保持。

## Review Focus

- 阶段标题按钮必须控制真实内容区和操作区，而不是只隐藏标题视觉；回归测试检查 `aria-controls`、内容区 class 和折叠选择器。
- 同阶段普通 snapshot 不得清除手动折叠；测试覆盖折叠后重复同步。
- “非自己→自己”只触发一次自动展开；测试覆盖持续自己状态的重复同步不反复触发。
- 阶段切换必须展开新阶段并清理该阶段旧折叠标记；测试覆盖返回此前折叠过的阶段。
- 购牌/行动现有操作渲染仍在对应阶段内容区，且测试/语法检查不回退。

### Task 1: 阶段标题语义与折叠样式

**Files:**
- Modify: `index.html` phase rail markup
- Modify: `styles.css` phase-step header/content collapsed states
- Test: `tests/ui.test.js`

**Interfaces:**
- Produces each phase header button with `data-phase-toggle`, `aria-expanded`, and `aria-controls` targeting that phase's content wrapper.

- [x] **Step 1: Write the failing static assertions** for the header button, target content wrapper, `aria-expanded`, and collapsed CSS selector.
- [x] **Step 2: Run the focused UI test** and confirm the assertions fail because markup/style is absent.
- [x] **Step 3: Add the header button/content wrapper and CSS** while preserving existing `purchase-actions` and `legal-actions` IDs inside their wrappers.
- [x] **Step 4: Run the focused UI test** and confirm it passes.

### Task 2: Client fold state and phase-edge behavior

**Files:**
- Modify: `app.js` state, phase guide renderer, and phase header listeners
- Test: `tests/ui.test.js`

**Interfaces:**
- `collapsedPhases: new Set()` stores local phase keys.
- `renderPhaseGuide(snapshot)` compares `state.lastPhase`, `state.lastActiveSeat`, and the current viewer seat; it expands on phase change or a false→true self-turn edge, otherwise preserves the set.

- [x] **Step 1: Write failing static assertions** for local state, click toggle, `aria-expanded` updates, phase-change expansion, self-turn edge expansion, and a visible “可操作” guidance branch.
- [x] **Step 2: Run the focused UI test** and confirm it fails on the missing behavior.
- [x] **Step 3: Implement the smallest state/renderer/listener change**; leave action legality and submission unchanged.
- [x] **Step 4: Run the focused UI test** and the existing purchase/phase tests.

### Task 3: Full verification and handoff

**Files:**
- Modify: `docs/superpowers/specs/2026-10-23-phase-collapse-design.md` only if implementation decisions need recording.

- [x] **Step 1: Run `npm test`** and require all tests to pass.
- [x] **Step 2: Run `node --check` for browser scripts and `git diff --check`.**
- [x] **Step 3: Run a local browser smoke at desktop and mobile widths** confirming click collapse, auto expansion on self-turn, and actual action content visibility.
- [ ] **Step 4: Commit and push, verify `HEAD == origin/main` and a clean worktree, then report the commit and evidence.**
