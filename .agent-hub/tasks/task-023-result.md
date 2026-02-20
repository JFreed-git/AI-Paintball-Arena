# Task 023 Result: Code Audit — Game Loop Integration

## Status
Complete

## Worker
Worker-3

## Audit Summary

All three files audited. **No critical bugs found.** Two low-severity observations noted. The integration code is well-structured and correct.

---

## modeFFA.js

### 1. Ability update for ALL players
**PASS.** Phase 1c (lines 1304-1311) iterates all player IDs and calls `abilityManager.update(dtMs)` for every player (local, remote, and AI). Correctly converts `dt` (seconds) to milliseconds.

### 2. Input → activation
**PASS.** Lines 1315-1323 iterate `getHUDState()` for the local player and check `localInput[abState[ai].key]` for each ability. Correctly guarded by `state.inputEnabled`.

### 3. Right-click dispatch (scope vs grapple)
**PASS.** Lines 1326-1341 check if any registered ability has `key === 'secondaryDown'`. If yes, the ability consumes the right-click and scope ADS is disabled (line 1338-1339 calls `updateScopeADS(weapon, false, dt)` to decay scope cleanly). If no secondary ability, scope ADS engages normally. Correctly captures `_localSecondaryDown` from input (line 1317) for scope pass-through.

### 4. Scope spread
**PASS.** `handleShooting()` (line 1073-1074) applies `state._scopeResult.spreadMultiplier` to effective spread when ADS is active. Only applied for the local player (`id === state.localId`), which is correct since remote players' spread is computed server-side by the host.

### 5. Burst fire
**PASS.** `handleShooting()` (lines 1140-1148) correctly uses `sharedStartBurst` for burst weapons with `originFn`/`dirFn` functions (not static values) — critical for correct multi-shot burst aiming. `sharedUpdateBursts(performance.now())` called in Phase 3 (line 1366) after `updateProjectiles`, which is correct ordering.

### 6. Sprint lockout
**PASS.** Lines 1353-1357 check `entry.entity.input.sprint` AND `abilityManager.hasPassive('sprintLockout')`. Blocks both `fireDown` and `meleeDown`. Applied to all human players in the combat loop.

### 7. Resets
**PASS.** `resetScopeADS()` and `sharedClearBursts()` are called at all required points:
- Hero switch / `applyHeroConfig()` (line 267-268)
- Round start / `startNextRound()` (line 583-584)
- Respawn / `respawnPlayer()` (line 610-611)
- Round end / `endRound()` (line 774-775)
- Mode stop / `stopFFAInternal()` (line 2506-2507)

### 8. Client tick
**PASS.** `simulateClientTick` (lines 1584-1617) correctly handles:
- Ability update + input activation (lines 1584-1597)
- Scope ADS with secondary ability check (lines 1600-1613)
- Burst updates (line 1617)
- HUD update (line 1619)

### 9. Tick ordering
**PASS.** Phase 1a (human physics) → Phase 1b (AI tick, includes AI shooting) → Phase 1c (ability updates) → Phase 2 (human combat) → Phase 3 (projectiles + bursts) → Phase 4 (hitbox viz) → Phase 7 (ability HUD). Abilities are updated before human shooting. Bursts are updated after projectiles. Correct.

**Observation (Low):** AI abilities are activated in Phase 1b (inside `_evaluateAbilities`) and then `abilityManager.update()` runs in Phase 1c, meaning the cooldown gets one frame's tick-down immediately after activation. This is cosmetic — the net cooldown over the full duration is effectively identical. No fix needed.

---

## modeTraining.js

### 1. Parity with FFA
**PASS.** Training mode has all the same integration:
- Ability update + input activation (lines 420-428)
- Scope/ADS with secondary ability check (lines 431-444)
- Sprint lockout (lines 453-458)
- Burst fire with `sharedStartBurst` using `originFn`/`dirFn` functions (lines 325-328)
- Burst update via `sharedUpdateBursts` (line 465)
- Ability HUD update (lines 472-475)
- Hitbox viz (line 468)

### 2. Player reference
**PASS.** Training mode uses `state.player` (single player object), accessed consistently throughout. No confusion with FFA's `state.players[id].entity` pattern.

### 3. Resets
**PASS.**
- Hero switch / `switchTrainingHero()` (lines 186-187): calls `resetScopeADS()` and `sharedClearBursts()`
- Mode stop / `stopTrainingRangeInternal()` (lines 624-625): calls `sharedClearBursts()` and `resetScopeADS()`

### 4. Tick ordering
**PASS.** Physics → bots/targets → abilities → scope → combat → projectiles → bursts → hitbox viz → HUD → ability HUD. Correct order.

---

## aiOpponent.js

### 1. _evaluateAbilities timing
**PASS.** Called at line 1111, after the state machine logic and before `_applyMovement`. This ensures ability decisions are informed by the current state (ENGAGE, SEEK_COVER, etc.) and executed before physics applies movement.

### 2. Dash heuristics
**PASS.** Reasonable per-playstyle logic:
- **aggressive**: Dash when engaging at 8-20 range with LOS, or during spawn rush
- **defensive**: Only dash to escape when health < 50%
- **melee**: Dash toward target when in ENGAGE beyond max range, during patrol with LOS, or spawn rush
- **balanced**: Offensive dash when healthy + in range, defensive dash when low health in cover, spawn rush
All have sensible state and distance checks.

### 3. Guard clauses
**PASS.** `_evaluateAbilities` (line 684) checks `if (!this.player.abilityManager) return;` before accessing. Safe for any hero config.

### 4. AI burst fire
**PASS.** `_tryShoot()` (lines 607-610) checks `this.weapon.burst && window.sharedStartBurst`, uses `originFn`/`dirFn` functions (not static values). Consistent with FFA host and training mode patterns.

### 5. Missing abilities (hero with no abilities)
**PASS.** If a hero has no registered abilities, `am.isReady('dash')` returns `true` (no cooldown entry) but `am.activate('dash')` returns `false` (no ability def in `_abilities`). The `_evaluateAbilities` method safely does nothing. No crash risk.

**Observation (Low):** `_evaluateAbilities` only evaluates the `dash` ability. If future heroes have other abilities (e.g. grappleHook on Brawler), the AI won't use them. This is expected — the TODO in the file header mentions expanding for future abilities. No fix needed now; future work.

---

## Issues Found

| # | File | Line | Severity | Description |
|---|------|------|----------|-------------|
| — | — | — | — | No bugs found |

## Observations (informational, no fix needed)

| # | File | Lines | Severity | Description |
|---|------|-------|----------|-------------|
| 1 | modeFFA.js | 1301-1310 | Low | AI ability activation (Phase 1b) runs before abilityManager.update (Phase 1c), causing one frame of cooldown tick-down immediately after activation. Net effect is negligible. |
| 2 | aiOpponent.js | 683-725 | Low | `_evaluateAbilities` only handles `dash`. AI heroes with other abilities (grappleHook, etc.) won't use them. Expected — noted as future work in file header. |
