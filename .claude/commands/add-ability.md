# Add a New Ability

Implement a new hero or weapon ability for the paintball game.

## User Input
$ARGUMENTS

## Instructions

First, read these files to understand the current system:
- `abilities.js` — AbilityManager runtime: effect registry, cooldown tracking, activation, mana system, and 6 existing registered effects (dash, grappleHook, unlimitedAmmo, teleport, piercingBlast, meditate)
- `heroes.js` — Hero definitions with `passives[]` and `abilities[]` arrays
- `weapon.js` — Weapon class with `abilities[]` array
- `input.js` — Keyboard/mouse input with remappable keymap (Q/E/F/C for abilities, RMB for secondaryDown)
- `hud.js` — Ability HUD (`updateAbilityHUD`), mana bar (`updateManaHUD`), `ABILITY_ICONS` SVG registry
- `player.js` — Player class with `abilityManager` instance
- `docs/heroes-and-combat.md` — Full ability system documentation

## Ability Architecture

The ability system is fully implemented. There are two kinds of abilities:

### Passive Abilities
- Always active, no cooldown, no input
- Defined on `hero.passives[]` as `{ id: 'passiveName' }`
- Checked by game systems via `player.abilityManager.hasPassive('passiveName')`

### Active Abilities
- Triggered by keybind, have cooldown, optional duration
- Defined on `hero.abilities[]` in the hero JSON:
```json
{
  "id": "myAbility",
  "name": "My Ability",
  "key": "ability1",
  "cooldownMs": 10000,
  "duration": 500,
  "params": { "speed": 30 }
}
```
- `key` maps to input actions: `ability1` (Q), `ability2` (E), `ability3` (F), `ability4` (C), `secondaryDown` (RMB)
- `duration` controls how long the effect stays active (0 or absent = instant, only `onActivate` fires)
- `params` is passed through to effect callbacks

## Current System (Fully Implemented)

The `AbilityManager` in `abilities.js` has:
- `registerAbility(def)` / `registerPassive(def)` — called by `applyHeroToPlayer()`
- `activate(abilityId)` — checks cooldown, dispatches `onActivate`, starts cooldown + duration
- `update(dt)` — ticks cooldowns, ticks active effects (`onTick`), calls `onEnd` on expiry, mana regen
- `isReady(id)` / `isActive(id)` / `getCooldownPercent(id)` — queries
- `getHUDState()` — returns array for ability HUD rendering
- `reset()` / `clearAbilities()` — lifecycle management
- Mana system: `initMana()`, `consumeMana()`, `addMana()`, `hasMana()`, `getMana()`, `getMaxMana()`

**Already wired up:**
- Input capture: `input.js` captures Q/E/F/C as `ability1`-`ability4` one-shot inputs, RMB as `secondaryDown` toggle
- Player integration: Every `Player` has `this.abilityManager = new AbilityManager(this)`
- Game mode integration: Both `modeFFA.js` and `modeTraining.js` call `abilityManager.update(dt)` and handle ability activation in their tick functions
- HUD: `updateAbilityHUD()` renders cooldown slots with SVG icons from `ABILITY_ICONS` registry
- Mana bar: `updateManaHUD()` for heroes with mana

## Implementation Steps

To add a new ability:

1. **Register the effect** in `abilities.js` at the bottom (after existing effects):
```js
AbilityManager.registerEffect('myAbility', {
  onActivate: function(player, params) {
    // Called when ability activates. Return false to abort.
    // Set up state on the player object.
  },
  onTick: function(player, params, dt) {
    // Called every frame while active (only if duration > 0).
    // dt is in milliseconds.
  },
  onEnd: function(player, params) {
    // Called when duration expires or effect is force-ended.
    // Clean up any state/visuals set on the player.
  }
});
```

2. **Add the ability to a hero JSON** in `heroes/`:
```json
{
  "abilities": [
    {
      "id": "myAbility",
      "name": "My Ability",
      "key": "ability1",
      "cooldownMs": 10000,
      "duration": 500,
      "params": { "customParam": 42 }
    }
  ]
}
```

3. **Add an SVG icon** to `ABILITY_ICONS` in `hud.js` (keyed by the ability ID):
```js
myAbility: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">...</svg>'
```

4. **If the ability uses mana**, add a `mana` config to the hero JSON:
```json
"mana": { "maxMana": 100, "regenRate": 10, "regenDelay": 2000 }
```
And consume mana in `onActivate`: `player.abilityManager.consumeMana(params.manaCost)`

5. **Update `docs/heroes-and-combat.md`** with the new ability in the Registered Effects table

## Existing Effects (Reference)

| Effect ID | Hero | Description |
|-----------|------|-------------|
| `dash` | Slicer | Burst velocity in look direction (200ms). Uses `_dashDir`/`_dashSpeed` on player. |
| `grappleHook` | Brawler | Pulls nearest enemy in aim cone. Green chain visual. Wall collision on pulled target. |
| `unlimitedAmmo` | Marksman | Weapon stops consuming ammo for duration. |
| `teleport` | Mage | Two-phase: Q shows ghost preview, Q/click confirms, RMB cancels. 3D cursor-targeted. |
| `piercingBlast` | Mage | Hold RMB to charge (drains mana), release to fire hitscan beam. Damage scales with mana spent. |
| `meditate` | Mage | Channel: freezes player, restores mana, interrupted by damage. Blue ring visual. |

## Important Notes

- Keep the IIFE module pattern. Expose new APIs on `window.*`.
- Follow existing code style (var declarations, no ES6 classes except AIOpponent).
- Clean up ALL state and visuals in `onEnd` — this is called on hero switch, round reset, and effect expiry.
- Use `player.cameraAttached` to check if the player is the local player (for screen overlays, sounds).
- Get game state for raycasting/candidates via `window.getFFAState()` and `window.getTrainingRangeState()` (see grappleHook helpers for pattern).
- Test that the ability works in both FFA mode and Training Range.
