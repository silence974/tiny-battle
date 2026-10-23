# 312 Action Build Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AP-aware action type entries, two equivalent pointer-based build selection paths, and reachable dispatch/recruit subflows.

**Architecture:** The engine remains authoritative for legal build targets and adds the missing orthogonal adjacency check to both action generation and command validation. The browser stores small build/dispatch/recruit drafts and renders type-level action controls, board/card visual states, and confirmation commands without inventing rule legality.

**Tech Stack:** Browser JavaScript, CSS, HTML, Node `node:test`, existing `engine312.js` and Supabase transport.

**Spec:** `docs/superpowers/specs/2026-10-23-action-build-interaction-design.md`

## Global Constraints

- Build targets must be explored ordinary land, empty, non-black, and orthogonally adjacent to a controlled tile owned by the acting player.
- The engine is authoritative; the browser consumes `legalActions` and revalidates through the existing command path.
- Confirmation is the only point that sends a build command and spends resources/AP.
- No explanatory copy is added for build mode; use visual states and existing controls.
- Mouse and touch use the same Pointer Events flow.

## Review Focus

- A non-adjacent empty tile must not appear as a legal build target or accept a forged build command — Task 1 engine regression.
- A player with no active barracks must not see a recruit type entry, while build/dispatch remain independently discoverable — Task 2 UI regression.
- A legal deploy action must remain reachable under the dispatch entry rather than disappearing when the UI collapses action types — Task 2 engine/UI regression.
- A build draft must not spend resources before confirmation, and stale/failed confirmation must clear it — Task 3 interaction regression.
- Both drag-first and tile-first selection must produce the same pending draft — Task 3 interaction regression.
- Mobile pointer input must not create page overflow or leave a ghost after pointer cancellation — Task 3 browser smoke.
- Dispatch must keep both route movement and deploy reachable; route force selection must remain after detail close — Task 4 browser smoke.
- Recruit must expose one unit type at a time and permit at most three units — Task 4 engine/UI regression.

### Task 1: Make engine build adjacency authoritative

**Files:**
- Modify: `engine312.js` near `legalActions()` and the action `build` branch.
- Test: `tests/engine312.test.js`.

**Interfaces:**
- Produces legal `build` actions only for targets adjacent to an owned controlled tile.
- Rejects direct `build` commands that do not satisfy the same adjacency predicate.

- [x] Write failing tests for adjacent legal target, non-adjacent exclusion, and forged command rejection.
- [x] Run the focused engine tests and verify the new cases fail for the missing adjacency rule before implementation.
- [x] Implement one shared orthogonal-adjacency predicate and use it in both legality generation and command validation.
- [x] Run the focused engine tests, then `node --test tests/engine312.test.js`.
- [x] Commit `Enforce adjacent controlled build targets` (`8edd1e0`).

### Task 2: Render action types and AP readout

**Files:**
- Modify: `index.html` action phase content.
- Modify: `app.js` state/render action functions.
- Modify: `styles.css` action-entry styles.
- Test: `tests/ui.test.js`.

**Interfaces:**
- Consumes snapshot `players`, `activeSeat`, `legalActions`, and current viewer hand.
- Produces `action-ap`, type-level `action-entry` controls, and a separate `action-pass` control.

- [x] Write UI assertions for AP remaining/total, three type entries, separate finish control, and hidden recruit entry when no recruit action exists.
- [x] Run the focused UI test and verify it fails before implementation.
- [x] Implement AP readout and type-entry rendering; route both `dispatch` and `deploy` actions through the visible 派遣 entry, while leaving engine legality intact.
- [x] Run focused UI tests and verify all action-entry assertions pass.
- [x] Keep `dispatch` and `deploy` reachable under the visible 派遣 entry.

### Task 3: Implement build draft selection and confirmation

**Files:**
- Modify: `app.js` board/hand/action render and pointer handlers.
- Modify: `styles.css` drag ghost, legal-target, selected-card, virtual-building, and disabled-card states.
- Test: `tests/ui.test.js` plus Chrome CDP smoke.

**Interfaces:**
- Consumes engine-produced build actions and existing `submitAction(action)`.
- Produces a shared build draft `{ building, at, action }`, pointer drag handling, tile-first selection, and one confirmation button.

- [x] Write UI assertions for build draft state, Pointer Events, legal target highlighting, `aria-disabled` cards, virtual building, and one confirmation control.
- [x] Run focused UI tests and verify they fail for the missing draft flow.
- [x] Implement `clearBuildDraft`, legal-build lookup, `renderBuildMode`, pointer drag ghost, tile-first card selection, and confirmation guarded by the current legal action.
- [x] Clear the draft on phase exit, snapshot invalidation, cancel, pointer cancel, and submit failure; keep resources/AP untouched before confirmation.
- [ ] Run focused UI tests and a local Chrome smoke at 1440×900 and 390×844 covering drag-first, tile-first, no-recruit state, confirmation, and no overflow.
- [x] Run the full suite and browser syntax/diff checks.

### Task 4: Dispatch and recruit subflows

**Files:** `app.js`, `styles.css`, `config-312.js`, `tests/ui.test.js`, `tests/engine312.test.js`

- [x] Implement start-cell filtering, adjacent route selection, endpoint locking, route highlighting, force `− / +`, summary, confirmation, and movement feedback.
- [x] Keep `deploy` buttons under 派遣 and make recruit a one-unit-type, max-three selector.
- [x] Mark an unexplored locked endpoint as `战斗`, while retaining route/source detail access and force selection.
- [x] Run full tests and desktop/mobile browser smoke.

