# 312 Action Build Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add AP-aware action type entries and two equivalent, pointer-based build selection paths that converge on one confirmed build command.

**Architecture:** The engine remains authoritative for legal build targets and adds the missing orthogonal adjacency check to both action generation and command validation. The browser stores a small build draft and renders type-level action controls, board/card visual states, and one confirmation command without inventing rule legality.

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

### Task 1: Make engine build adjacency authoritative

**Files:**
- Modify: `engine312.js` near `legalActions()` and the action `build` branch.
- Test: `tests/engine312.test.js`.

**Interfaces:**
- Produces legal `build` actions only for targets adjacent to an owned controlled tile.
- Rejects direct `build` commands that do not satisfy the same adjacency predicate.

- [ ] Write failing tests for adjacent legal target, non-adjacent exclusion, and forged command rejection.
- [ ] Run `node --test tests/engine312.test.js --test-name-pattern='build'` and verify the new cases fail for the missing adjacency rule.
- [ ] Implement one shared orthogonal-adjacency predicate and use it in both legality generation and command validation.
- [ ] Run the focused engine tests, then `node --test tests/engine312.test.js`.
- [ ] Commit `Enforce adjacent controlled build targets`.

### Task 2: Render action types and AP readout

**Files:**
- Modify: `index.html` action phase content.
- Modify: `app.js` state/render action functions.
- Modify: `styles.css` action-entry styles.
- Test: `tests/ui.test.js`.

**Interfaces:**
- Consumes snapshot `players`, `activeSeat`, `legalActions`, and current viewer hand.
- Produces `action-ap`, type-level `action-entry` controls, and a separate `action-pass` control.

- [ ] Write failing UI assertions for AP remaining/total, three type entries, separate finish control, and hidden recruit entry when no recruit action exists.
- [ ] Run the focused UI test and verify it fails before implementation.
- [ ] Implement AP readout and type-entry rendering; route both `dispatch` and `deploy` actions through the visible 派遣 entry, while leaving engine legality intact.
- [ ] Run focused UI tests and verify all action-entry assertions pass.
- [ ] Commit `Render action type entries and AP readout`.

### Task 3: Implement build draft selection and confirmation

**Files:**
- Modify: `app.js` board/hand/action render and pointer handlers.
- Modify: `styles.css` drag ghost, legal-target, selected-card, virtual-building, and disabled-card states.
- Test: `tests/ui.test.js` plus Chrome CDP smoke.

**Interfaces:**
- Consumes engine-produced build actions and existing `submitAction(action)`.
- Produces a shared build draft `{ building, at, action }`, pointer drag handling, tile-first selection, and one confirmation button.

- [ ] Write failing UI assertions for build draft state, Pointer Events, legal target highlighting, `aria-disabled` cards, virtual building, and one confirmation control.
- [ ] Run focused UI tests and verify they fail for the missing draft flow.
- [ ] Implement `clearBuildDraft`, legal-build lookup, `renderBuildMode`, pointer drag ghost, tile-first card selection, and confirmation guarded by the current legal action.
- [ ] Clear the draft on phase exit, snapshot invalidation, cancel, pointer cancel, and submit failure; keep resources/AP untouched before confirmation.
- [ ] Run focused UI tests and a local Chrome smoke at 1440×900 and 390×844 covering drag-first, tile-first, no-recruit state, confirmation, and no overflow.
- [ ] Run the full suite and browser syntax/diff checks.
- [ ] Commit `Add two-path build interaction`.

