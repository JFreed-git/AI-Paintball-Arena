# Add a New Ability

Implement a new hero or weapon ability for the paintball game.

## User Input
$ARGUMENTS

## Instructions

First, read these files to understand the current system:
- `abilities.js` — AbilityManager runtime (cooldown tracking exists, activation/effects are TODO)
- `heroes.js` — Hero definitions with `passives[]` and `abilities[]` arrays
- `weapon.js` — Weapon class with `abilities[]` array
- `input.js` — Keyboard/mouse input handling (needs keybind support for abilities)
- `physics.js` — Movement engine (`updateFullPhysics`) for movement abilities
- `projectiles.js` — `sharedFireWeapon` for combat abilities
- `hud.js` — HUD management (needs cooldown indicator support)
- `player.js` — Player class (may need new state for ability effects)
- `modeFFA.js`, `modeTraining.js` — Game loops that call `update(dt)`

## Ability Architecture

There are two kinds of abilities:

### Passive Abilities
- Always active, no cooldown, no input
- Defined on `hero.passives[]`
- Checked by game systems (e.g. physics checks 'doubleJump')
- Shape: `{ id: 'doubleJump', type: 'passive', description: '...' }`
- Implementation: add a check in the relevant system file (physics.js for movement passives, projectiles.js for combat passives, etc.)

### Active Abilities
- Triggered by keybind, have cooldown
- Defined on `hero.abilities[]` (hero abilities) or `weapon.abilities[]` (weapon abilities)
- Shape:
```js
{
  id: 'dash',
  type: 'active',
  cooldownSec: 8,        // seconds between uses
  duration: 0.3,         // how long effect lasts (0 for instant)
  keybind: 'q',          // key to activate
  description: 'Quick forward dash'
}
```

## Current State of the System

The `AbilityManager` in `abilities.js` already has:
- `hasPassive(id)` — checks if a passive exists
- `getCooldownPercent(id)` — returns 0.0-1.0 for HUD
- `isReady(id)` — checks if off cooldown
- `update(dt)` — ticks down cooldowns and active effects
- `reset()` — clears all state between rounds

What's NOT implemented yet (you'll need to build what's needed):
- **Input capture**: `input.js` doesn't capture ability keybinds (Q, E, etc.)
- **Activation logic**: `AbilityManager.update()` doesn't check input or fire callbacks
- **Effect system**: No callback registry for ability effects
- **Player integration**: Player class doesn't create or hold an AbilityManager
- **Game mode integration**: Mode tick functions don't call `abilityManager.update()`
- **HUD**: No cooldown indicator UI
- **Networking**: No ability activation events for LAN mode

## Implementation Steps

For each new ability, you need to:

1. **Define the ability data** on the appropriate hero/weapon in `heroes.js`

2. **Wire up AbilityManager** (if not already done for a prior ability):
   - Create AbilityManager in Player constructor or in `applyHeroToPlayer()`
   - Call `mgr.update(dt, inputState)` in game mode tick functions
   - Handle keybind input in `input.js` (add ability key states to `getInputState()`)

3. **Implement the effect** in the relevant system file:
   - Movement abilities (dash, double jump, wall climb) → `physics.js`
   - Combat abilities (charged shot, alt-fire) → `projectiles.js`
   - Defensive abilities (shield, heal) → `player.js`
   - The effect function receives the player and dt, modifies state directly

4. **Add activation logic** in `AbilityManager.update()`:
   - Check if keybind pressed and ability is ready
   - Start cooldown, start active effect duration
   - Call the effect callback

5. **Add the ability to a hero** in `heroes.js`

6. **Update CLAUDE.md** with any new exports, architecture changes, or API additions

## Example: Implementing a Dash Ability

This is a reference for how a movement ability would work:

1. In `heroes.js`, add to a hero's `abilities[]`:
   ```js
   { id: 'dash', type: 'active', cooldownSec: 6, duration: 0.15, keybind: 'q', description: 'Burst of speed forward' }
   ```

2. In `input.js`, add ability key tracking to `getInputState()`:
   ```js
   ability1Pressed: _keys['q'] || false
   ```

3. In `abilities.js`, add activation in `update()`:
   ```js
   // Check keybind → if ready → start cooldown → call effect
   ```

4. In `physics.js` or the game mode tick, apply the dash effect:
   ```js
   // Temporarily boost player velocity in camera forward direction
   ```

## Important Notes

- Keep the IIFE module pattern. Expose new APIs on `window.*`.
- Follow existing code style (var declarations, no ES6 classes except AIOpponent).
- The ability system is being built incrementally — only implement what's needed for this specific ability. Don't over-architect for hypothetical future abilities.
- If this is the FIRST ability being implemented, you'll need to wire up the foundational infrastructure (AbilityManager on Player, input capture, game mode integration). Document what you added.
- Test that the ability works in FFA mode (modeFFA.js) at minimum.
