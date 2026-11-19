# API reference

Everything a script can do. `m` is the object your `run` callback gets. The docs site has the same reference with
guides and a course: https://c3d-gg.github.io/melvor2-script/

- **Reads are synchronous.** `m.state` mirrors the game, pushed whenever it changes (up to 4 times a second).
  `m.count(...)`, `m.gp` and `m.skills.woodcutting.level` read from it.
- **Real time** (the default): `start(recipe)` repeats an action like a click. Changing what the character does is
  limited to one switch per second; `start()` waits that out itself.
- **Scripted Mode** (`bunx melvor2 scripted on`, per save): `act(recipe)` happens at once, then a cooldown of the
  action's time ÷ speed. Calling it while `!m.ready` rejects at once with `COOLDOWN` or `BUSY`.
- **Ids are typed.** `Items.NormalLog`, `WoodcuttingRecipes.NormalTree`, `Enemies.Golbin`: a typo fails at compile
  time. See [Ids](#ids).

Generated from the source by `bun run docs`. The descriptions are the doc comments VS Code shows on hover.

## m

The game, from a script's point of view: its live state, your skills, combat, events and the
Scripted Mode cooldown. `run()` hands you one; every example calls it `m`.

Skills and combat have their own sections: [`m.skills`](#mskills) and [`m.combat`](#mcombat).

### Starting a script

- **`run(main: (m: Melvor) => unknown | Promise<unknown>, opts: { name?: string } = {}): Promise<void>`**
  Connect to the game and run your script.

  - `async` main: the script ends when it resolves (unless you registered `on`/`onState` listeners).
  - plain (sync) main, e.g. a setInterval loop: runs until Ctrl+C.

  The character keeps doing its last action after the script ends (it's an idle game).

  An error your script throws (or doesn't catch) stops it and is printed as `CODE: message`.
  `opts.name` is how the game's log names the script (default: the file name).

### Live state

Synchronous reads of the state the game pushes, and ways to wait for it to change.

- **`m.state: GameState`**
  Live mirror of the game, refreshed whenever it changes (up to 4 times a second).
- **`m.count(item: string): number`**
  How many of an item are in the bank.
- **`m.gp: number`**
  Gold pieces in the bank.
- **`m.onState(fn: (s: GameState) => void): () => void`**
  Called with every new state.
- **`m.waitFor(pred: (s: GameState) => boolean, timeoutMs = Infinity): Promise<GameState>`**
  Resolves once `pred(state)` is true. With `timeoutMs`, rejects with an Error ('waitFor timed out') after that long.
- **`m.on<T extends GameEvent['type'] | '*'>(type: T, fn: (e: T extends '*' ? GameEvent : Extract<GameEvent, { type: T }>) => void): () => void`**
  Listen for game events: 'levelUp', 'actionChanged', 'modeChanged', or '*' for all. Returns an unsubscribe function.

### Scripted Mode

The settings and the cooldown. The actions themselves are `m.skills.<name>.act()`. See [Scripted Mode](https://c3d-gg.github.io/melvor2-script/concepts/scripted-mode/).

- **`m.scripted: boolean`**
  Scripted Mode is on for this save: actions are instant, then a cooldown. Turn it on with
  `bunx melvor2 scripted on`, or `m.setScripted({ on: true })`.
- **`m.speed: number`**
  Scripted Mode speed (1 to 1000, default 10): cooldown = action time ÷ speed, at least 50 ms.
- **`m.cooldown: number`**
  Milliseconds until the next action is allowed (0 = now).
- **`m.ready: boolean`**
  True when an `act` call would go through right now.
- **`m.whenReady(): Promise<void>`**
  Resolves when `m.ready` is true.
- **`m.setScripted(opts: { on?: boolean; speed?: number }): Promise<ScriptedStatus>`**
  Turn Scripted Mode on/off for the loaded save, or change the speed (1 to 1000, shared by all
  Scripted saves). Turning it on stops the current action. Same as `bunx melvor2 scripted on` and
  `bunx melvor2 speed 50`.

### Doing things

- **`m.stop(): Promise<{ stopped: boolean; active: boolean; }>`**
  Stop whatever the character is doing, and cancel a running multi-action `act`.
- **`m.log(...parts: unknown[]): void`**
  Print in your terminal and in the game's log.
- **`m.loadSave(id?: string): Promise<{ loading: string; name: string; }>`**
  From the main menu, load a save (the most recent by default). Throws NOT_READY anywhere else.

### More

- **`m.conn: Connection`**
  The low-level connection. `m.conn.call(method, params)` sends any call from the protocol,
  including ones `m` doesn't wrap (yet), e.g. `m.conn.call('skill.recipes', { skill: Skills.Mining })`.
- **`m.hasListeners: boolean`**
  True while an `on` or `onState` listener is registered: `run()` keeps an async script alive while it is.

## m.skills

One object per skill, named like the `Skills` ids but starting lower case: `m.skills.woodcutting`,
`m.skills.mining`, `m.skills.beastcrafting`... Each has its live level and XP, and its actions.

### Every skill

One skill: live level and XP from `m.state`, plus its actions.

Actions (`start`, `act`, `recipes`) work for Woodcutting, Mining and Fishing, and for every crafting
skill: Smithing, Cooking, Firemaking, Crafting, Fletching, Runecrafting, Herblore and Beastcrafting.
The other skills reject them with UNSUPPORTED for now; their level and XP still work.

- **`m.skills.<name>.id: string`**
  The skill's id, e.g. 'MelvorBase:Woodcutting' (the same as `Skills.Woodcutting`).
- **`m.skills.<name>.level: number`**
  Current level (0 until the first state arrives).
- **`m.skills.<name>.xp: number`**
  Total XP in this skill.
- **`m.skills.<name>.xpToNext: number`**
  XP still needed for the next level.
- **`m.skills.<name>.active: boolean`**
  True while this skill is the active action.
- **`m.skills.<name>.current: string | null`**
  The recipe being worked on, if this skill is active.
- **`m.skills.<name>.start(recipe: string): Promise<{ started: boolean; already?: boolean }>`** _(one switch per second)_
  Start (or switch to) a recipe: a tree, rock, fish, or anything a crafting skill makes. The action
  then repeats in real time like it does when you click it. Starting the current recipe does nothing.
  Waits out the 1 s switch cooldown by itself. Throws LOCKED / MISSING_ITEMS / NOT_FOUND, and
  UNSUPPORTED in Scripted Mode (use `act` there).
- **`m.skills.<name>.recipes(): Promise<RecipeInfo[]>`**
  Everything this skill can do, with `unlocked` = requirements met.
- **`m.skills.<name>.act(recipe: string, opts: { count?: number; allowStop?: boolean } = {}): Promise<ActionResult>`** _(Scripted Mode cooldown)_
  Scripted Mode: do the recipe at once (one hit, catch, craft step...), `count` times, spaced by the
  cooldown (action time ÷ speed). Resolves with what happened once you're ready to act again, so
  `while (...) await act(x)` paces itself.

  Calling it while not ready rejects at once with COOLDOWN (or BUSY), without reaching the game: check
  `m.ready` in loops. If a multi-action call ends early (out of materials, you clicked something else...)
  it throws with the partial result in `error.data`, unless you pass `allowStop: true`.
  Throws UNSUPPORTED when Scripted Mode is off for this save.

### Skill names

`m.skills.cooking`, `m.skills.crafting`, `m.skills.firemaking`, `m.skills.fishing`, `m.skills.herblore`, `m.skills.fletching`, `m.skills.mining`, `m.skills.runecrafting`, `m.skills.smithing`, `m.skills.woodcutting`, `m.skills.farming`, `m.skills.ranching`, `m.skills.hunting`, `m.skills.beastcrafting`, `m.skills.agility`, `m.skills.thieving`, `m.skills.slayer`, `m.skills.attack`, `m.skills.strength`, `m.skills.defence`, `m.skills.hitpoints`, `m.skills.ranged`, `m.skills.magic`, `m.skills.prayer`, `m.skills.astrology`.

## m.combat

Fighting. Combat runs in real time in both modes for now (turn-based Scripted combat is on the
roadmap). Pick a valid area and enemy pair with `AreaEnemies`.

- **`m.combat.fight(area: string, enemy: string): Promise<{ state: string; }>`** _(one switch per second)_
  Fight an enemy in an area (CombatAreas / Enemies ids). Combat runs in real time until you stop it.
  Like `start()`, it waits out the one-switch-per-second limit by itself. Throws BAD_REQUEST if the
  enemy isn't in that area and LOCKED if the area isn't unlocked.
- **`m.combat.stop(): Promise<{ stopped: boolean; }>`**
  Leave combat.
- **`m.combat.eat(): Promise<{ hp: number; healed: number; }>`**
  Eat the selected food once.
- **`m.combat.state: string`**
  'Idle', 'Spawning' or 'Fighting'.
- **`m.combat.hp: number`**
  Your hitpoints right now.
- **`m.combat.maxHp: number`**
  Your maximum hitpoints.

## Results

### `ActionResult`

What an `act` did (Scripted Mode).

| Field        | Type                     |                                                                                 |
| ------------ | ------------------------ | ------------------------------------------------------------------------------- |
| `completed`  | `boolean`                | False when it stopped early (only returned instead of thrown with `allowStop`). |
| `actions`    | `number`                 | How many actions ran.                                                           |
| `xp`         | `number`                 | XP gained in the acting skill.                                                  |
| `items`      | `Record<string, number>` | Bank changes, item id -> +/- quantity.                                          |
| `durationMs` | `number`                 | From the first action to the last, in milliseconds.                             |
| `readyInMs`  | `number`                 | Cooldown left when the reply was sent.                                          |
| `stopped?`   | `string`                 | Why it stopped early.                                                           |

### `ScriptedStatus`

Scripted Mode settings and pacing, from `m.setScripted()` or `bunx melvor2 scripted`.

| Field           | Type             |                                                                                        |
| --------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `on`            | `boolean`        | Scripted Mode is on for the loaded save.                                               |
| `speed`         | `number`         | Cooldown = action time ÷ speed. Shared by every Scripted save (1 to 1000, default 10). |
| `minCooldownMs` | `number`         | The shortest cooldown, whatever the speed (50 ms).                                     |
| `readyInMs`     | `number`         | Milliseconds until the next action is allowed.                                         |
| `busy`          | `boolean`        | A multi-action `act` is running.                                                       |
| `save`          | `string \| null` | The loaded save's id, or null on the main menu.                                        |

### `RecipeInfo`

One thing a skill can do, from `m.skills.<name>.recipes()`.

| Field      | Type      |                                                      |
| ---------- | --------- | ---------------------------------------------------- |
| `id`       | `string`  | Recipe id, e.g. 'MelvorBase:NormalTree'.             |
| `name`     | `string`  | In-game name, e.g. 'Normal Tree'.                    |
| `unlocked` | `boolean` | Requirements met: `start` and `act` would accept it. |

### `SaveInfo`

A save on this PC, from `bunx melvor2 saves`.

| Field        | Type     |                                            |
| ------------ | -------- | ------------------------------------------ |
| `id`         | `string` | Pass to `m.loadSave(id)`.                  |
| `name`       | `string` | Character name.                            |
| `timestamp`  | `string` | When it was last saved (ISO 8601).         |
| `totalLevel` | `number` |                                            |
| `source`     | `string` | Where the newest copy is (local or cloud). |

### `RuntimeInfo`

The runtime and the game, from `bunx melvor2 status`.

| Field            | Type     |                                               |
| ---------------- | -------- | --------------------------------------------- |
| `runtimeVersion` | `string` | The mod's version.                            |
| `generation`     | `number` | 1 after a game start, +1 per hot reload.      |
| `protocol`       | `number` | The protocol version (PROTOCOL_VERSION).      |
| `gameVersion`    | `string` | Melvor Idle 2's version, e.g. '0.11.6-alpha'. |
| `mode`           | `string` | Application mode, as in GameState.            |
| `dotnet`         | `string` | The .NET version the game runs on.            |

## m.state

The live mirror behind every synchronous read. `m.onState(fn)` and `m.waitFor(predicate)` watch it.

### `GameState`

The game as the runtime sees it. Pushed as a 'state' notification whenever it changes (max 4/s).

| Field         | Type                                                                 |                                                                                               |
| ------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `mode`        | `string`                                                             | Application mode: 'MainMenu', 'Game', 'MelvorCloud', ...                                      |
| `saveLoaded`  | `boolean`                                                            | A save is loaded and ready: actions work.                                                     |
| `offline`     | `boolean`                                                            | Offline progress is running. Calls that touch the game reject with NOT_READY until it's done. |
| `scripted?`   | `{ on: boolean; speed: number }`                                     | Scripted Mode for the loaded save (see ScriptedStatus).                                       |
| `skills?`     | `Record<string, SkillState>`                                         | Keyed by skill id, e.g. 'MelvorBase:Woodcutting'.                                             |
| `bank?`       | `Record<string, number>`                                             | Item id -> quantity.                                                                          |
| `bankSlots?`  | `{ used: number; max: number }`                                      | Bank slots in use, and how many there are.                                                    |
| `currencies?` | `Record<string, number>`                                             | Currency id -> amount ('MelvorBase:GoldPieces', ...).                                         |
| `active?`     | `ActiveAction[]`                                                     | What the character is doing (empty when idle).                                                |
| `combat?`     | `{ state: string; hp: number; maxHp: number; area: string \| null }` | Combat: 'Idle', 'Spawning' or 'Fighting', your hitpoints, and the area you're fighting in.    |

### `SkillState`

One skill in `m.state.skills`.

| Field      | Type     |                                       |
| ---------- | -------- | ------------------------------------- |
| `name`     | `string` | The in-game name, e.g. 'Woodcutting'. |
| `level`    | `number` |                                       |
| `xp`       | `number` | Total XP.                             |
| `xpToNext` | `number` | XP still needed for the next level.   |

### `ActiveAction`

What the character is doing: an entry of `m.state.active`.

| Field        | Type             |                                                                               |
| ------------ | ---------------- | ----------------------------------------------------------------------------- |
| `skill`      | `string`         | Skill id, e.g. 'MelvorBase:Woodcutting' ('MelvorBase:Combat' while fighting). |
| `recipe`     | `string \| null` | Recipe id, e.g. 'MelvorBase:NormalTree', when the action has one.             |
| `recipeName` | `string \| null` | The recipe's in-game name, e.g. 'Normal Tree'.                                |

## Events

Subscribe with `m.on(type, handler)` (returns an unsubscribe function); `'*'` gets every event.

| Type            | Fields                                           |                                                                           |
| --------------- | ------------------------------------------------ | ------------------------------------------------------------------------- |
| `levelUp`       | `{ skill: string; level: number; from: number }` | A skill gained a level (`from` is the level before).                      |
| `actionChanged` | `{ active: ActiveAction[] }`                     | The character started, switched or stopped an action (yours, or a click). |
| `modeChanged`   | `{ mode: string; saveLoaded: boolean }`          | The game changed screens, or a save finished loading or was closed.       |

## Errors

Failed calls reject with a `MelvorError`. An error the game sent back, or DISCONNECTED when the connection dropped. `code` says what kind (an ErrorCode), `message` says it in words, and `data` has details for some codes: `readyInMs` for COOLDOWN, the partial ActionResult for an `act` that stopped early. Besides `message`, it has `code: string` and `data: unknown`.

| Code             |                                                                                                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BAD_REQUEST`    | A missing or invalid parameter, e.g. an enemy that isn't in the area you named, or a speed outside 1..1000.                                                                       |
| `UNKNOWN_METHOD` | The game's mod doesn't know this call: it's older than your client. Update both to the same version.                                                                              |
| `NOT_FOUND`      | No such skill, recipe, item, area or enemy. With the typed ids this is rare.                                                                                                      |
| `LOCKED`         | Requirements not met: your level is too low, or an area isn't unlocked yet.                                                                                                       |
| `MISSING_ITEMS`  | Not enough materials (or bank space) for a crafting recipe.                                                                                                                       |
| `UNSUPPORTED`    | Not possible here: a skill without actions yet, `start()` in Scripted Mode, or `act()` with Scripted Mode off.                                                                    |
| `FAILED`         | The game didn't do it, for a reason the runtime couldn't name. The message says what it saw.                                                                                      |
| `NOT_READY`      | No save loaded, still loading, or offline progress is running.                                                                                                                    |
| `COOLDOWN`       | Not ready yet. Scripted Mode: the cooldown after the last action hasn't finished. Real time: changing the active action again within 1 s. `data.readyInMs` says how long is left. |
| `BUSY`           | Scripted Mode: a multi-action `act` is still running.                                                                                                                             |
| `RATE_LIMITED`   | More than 60 calls in one second from one script.                                                                                                                                 |
| `DISCONNECTED`   | Client-side only: the connection to the game dropped.                                                                                                                             |

## Protocol

Every call the runtime understands. `m.conn.call(method, params)` sends any of them, typed, including ones `m` doesn't wrap.

| Method            | Params                                                                   | Result                                       |                                                                                               |
| ----------------- | ------------------------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `runtime.hello`   | `{ name?: string }`                                                      | `RuntimeInfo`                                | Say who you are (shown in the game's log) and get the runtime info. `run()` sends it for you. |
| `runtime.info`    |                                                                          | `RuntimeInfo`                                | The runtime and game versions.                                                                |
| `runtime.reload`  |                                                                          | `{ reloading: boolean; generation: number }` | Swap the in-game runtime for the dll on disk without restarting the game (dev loop).          |
| `state.get`       |                                                                          | `GameState`                                  | The whole state, now. Scripts get it pushed as 'state' notifications instead.                 |
| `game.saves`      |                                                                          | `SaveInfo[]`                                 | The saves on this PC.                                                                         |
| `game.loadSave`   | `{ id?: string }`                                                        | `{ loading: string; name: string }`          | From the main menu: load a save (the most recent by default).                                 |
| `skill.recipes`   | `{ skill: string }`                                                      | `RecipeInfo[]`                               | What a skill can do, with `unlocked`.                                                         |
| `skill.start`     | `{ skill: string; recipe: string }`                                      | `{ started: boolean; already?: boolean }`    | Real time: start (or switch to) a recipe. Limited to one action switch per second (COOLDOWN). |
| `skill.act`       | `{ skill: string; recipe: string; count?: number; allowStop?: boolean }` | `ActionResult`                               | Scripted Mode: `count` instant actions spaced by the cooldown.                                |
| `scripted.status` |                                                                          | `ScriptedStatus`                             | Scripted Mode settings and the cooldown left.                                                 |
| `scripted.set`    | `{ on?: boolean; speed?: number }`                                       | `ScriptedStatus`                             | `on` applies to the loaded save; `speed` to all Scripted saves.                               |
| `action.stop`     |                                                                          | `{ stopped: boolean; active: boolean }`      | Stop whatever the character is doing, and cancel a running `act`.                             |
| `combat.fight`    | `{ area: string; enemy: string }`                                        | `{ state: string }`                          | Fight an enemy in an area. Counts as an action switch (one per second).                       |
| `combat.stop`     |                                                                          | `{ stopped: boolean }`                       | Leave combat.                                                                                 |
| `combat.eat`      |                                                                          | `{ hp: number; healed: number }`             | Eat the selected food once.                                                                   |
| `ui.log`          | `{ message: string }`                                                    | `null`                                       | Write a line in the game's log.                                                               |

## CLI

`bunx melvor2 <command>` in a scripts folder, `bun run melvor2 <command>` in a clone of the repo.

**Setup (no game needed)**

| Command      |                                                                                   |
| ------------ | --------------------------------------------------------------------------------- |
| `init`       | set up this folder for scripts (scripts/hello.ts, tsconfig, VS Code F5)           |
| `install`    | download this version's mod files from GitHub and install them into Melvor Idle 2 |
| `uninstall`  | remove the mod (override.cfg + the mod folder)                                    |
| `mod-status` | what's installed, and the end of each log                                         |

**Game (needs Melvor Idle 2 running with the mod)**

| Command                    |                                                                                |
| -------------------------- | ------------------------------------------------------------------------------ |
| `status`                   | runtime + game info                                                            |
| `state`                    | the current game state (JSON)                                                  |
| `saves`                    | saves on this machine                                                          |
| `load-save [id]`           | from the main menu: load a save (latest by default)                            |
| `recipes <Skill>`          | what a skill can do, e.g. recipes Woodcutting                                  |
| `scripted [on\|off]`       | Scripted Mode for the loaded save (no argument: show status)                   |
| `speed [n]`                | Scripted Mode speed, 1..1000 (no argument: show it)                            |
| `act <Skill> <recipe> [n]` | Scripted Mode: n instant actions, e.g. act Mining Stone 10                     |
| `call <method> [json]`     | any RPC, e.g. call skill.start '{"skill":"Woodcutting","recipe":"NormalTree"}' |
| `watch`                    | print events as they happen                                                    |
| `reload`                   | swap the in-game runtime for the freshly installed dll (dev loop, no restart)  |

## Ids

Const maps of every id in the game, from `import { Items, WoodcuttingRecipes, ... } from 'melvor2-script'`. Each has a matching type (`ItemId`, ...). They're generated from the game's data; in a clone of the repo, `bun run gen:ids` regenerates them from your installed game. Search them by name on the docs site: https://c3d-gg.github.io/melvor2-script/reference/ids/

| Map                    | Ids  | Example                                |                                              |
| ---------------------- | ---- | -------------------------------------- | -------------------------------------------- |
| `Skills`               | 25   | `Skills.Cooking`                       | Skill ids (use with m.skills / skill.start). |
| `CookingRecipes`       | 77   | `CookingRecipes.Shrimp`                | Cooking recipes (skill.start targets).       |
| `CraftingRecipes`      | 173  | `CraftingRecipes.LeatherVambraces`     | Crafting recipes (skill.start targets).      |
| `FiremakingRecipes`    | 27   | `FiremakingRecipes.NormalLog`          | Firemaking recipes (skill.start targets).    |
| `FishingRecipes`       | 24   | `FishingRecipes.LifebinderPool`        | Fishing recipes (skill.start targets).       |
| `HerbloreRecipes`      | 155  | `HerbloreRecipes.WoodcuttingPotionP1A` | Herblore recipes (skill.start targets).      |
| `FletchingRecipes`     | 66   | `FletchingRecipes.ArrowShaft`          | Fletching recipes (skill.start targets).     |
| `MiningRecipes`        | 28   | `MiningRecipes.StoneDebris`            | Mining recipes (skill.start targets).        |
| `RunecraftingRecipes`  | 123  | `RunecraftingRecipes.DustRunePack`     | Runecrafting recipes (skill.start targets).  |
| `SmithingRecipes`      | 208  | `SmithingRecipes.StoneSword`           | Smithing recipes (skill.start targets).      |
| `WoodcuttingRecipes`   | 22   | `WoodcuttingRecipes.WoodDebris`        | Woodcutting recipes (skill.start targets).   |
| `FarmingRecipes`       | 49   | `FarmingRecipes.Potato`                | Farming recipes (skill.start targets).       |
| `BeastcraftingRecipes` | 145  | `BeastcraftingRecipes.FurCamoHat`      | Beastcrafting recipes (skill.start targets). |
| `ThievingRecipes`      | 44   | `ThievingRecipes.Citizen`              | Thieving recipes (skill.start targets).      |
| `CombatAreas`          | 54   | `CombatAreas.GolbinForest`             | Combat areas (combat.fight).                 |
| `Enemies`              | 192  | `Enemies.Golbin`                       | Enemies (combat.fight).                      |
| `Currencies`           | 3    | `Currencies.GoldPieces`                | Currencies (state.currencies keys).          |
| `Items`                | 1811 | `Items.DefaultWeapon`                  | Every item (state.bank keys).                |

`AreaEnemies` maps each combat area to the enemies you can fight there: `AreaEnemies[CombatAreas.GolbinForest]`.
