# melvor2-script

Play **Melvor Idle 2** by writing TypeScript, like [melvor-script](../melvor-scripting-mod) did for Melvor 1. A mod
runs a local WebSocket server inside the game; your scripts (Bun, VS Code) are the client.

```ts
import { run, Items, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  await m.skills.woodcutting.start(WoodcuttingRecipes.NormalTree);
  await m.waitFor(() => m.count(Items.NormalLog) >= 5000);
  m.log('5000 logs!');
});
```

> **Status (2026-11-19, game 0.11.6-alpha):** early scaffold, working end to end in the real game: the loader,
> live state, starting gathering and crafting actions, combat checks, and hot reload were all tested.
> There's no official mod API yet, so a game update can break it. How it gets in, and what we know about the game's
> internals, is in [RESEARCH.md](RESEARCH.md).

## How it works

```
VS Code / bun ── scripts ── melvor2-script client ──WebSocket 127.0.0.1:7338──▶ Melvor Idle 2 (Godot 4.7 + .NET 10)
                                                                                 │
  override.cfg (next to Melvor2.exe) ─▶ autoload loader.gd ─▶ GDExtension bridge.dll
    ─▶ hostfxr (already in the game) ─▶ MelvorScript.Bootstrap ─▶ MelvorScript.Runtime (C#, the server)
```

- The game is C# under the hood. The runtime calls the same methods the UI buttons call, e.g.
  `WoodcuttingActionComponent.SelectTree` or `CraftingActionComponent.StartCreating`.
- The only file added to the game folder is `override.cfg`. Everything else lives in
  `%APPDATA%\Games By Malcs\Melvor Idle 2\melvor-script\`, along with the logs (`loader.log`, `bridge.log`,
  `bootstrap.log`, `runtime.log`).
- The token is in `~/.melvor2-scripting/config.json`, written on the first start. The server only listens on
  127.0.0.1 and refuses browsers (any request with an `Origin` header).

## Setup

Needs Bun, the **.NET 10 SDK** and a mingw **clang** (llvm-mingw).

- The SDK goes into a user-local folder, no admin needed:
  `dotnet-install.ps1 -Channel 10.0 -InstallDir $env:LOCALAPPDATA\Microsoft\dotnet`
- The tools look in that folder; set `DOTNET` to use another one.
- For clang: `winget install MartinStorsjo.LLVM-MinGW.UCRT`.

```sh
bun install
bun run build          # dist/: native bridge + C# bootstrap/runtime (compiles against your installed game)
bun run install-mod    # copies into the game's user folder + adds override.cfg
# restart Melvor Idle 2
bun run melvor2 status
bun examples/hello.ts
```

Other paths can be set with `MELVOR2_DIR` (game folder) and `MELVOR2_USER_DIR`.

**Turn it off:** delete `override.cfg` from the game folder. **Remove everything:** `bun run uninstall-mod`.
**Check it:** `bun run mod-status` shows the installed files and the last lines of every log.

## CLI

`bun run melvor2 <cmd>`:

| Command | What it does |
|---|---|
| `status` | Runtime and game version, which screen the game is on |
| `state` | Full state as JSON |
| `saves` | List saves |
| `load-save [id]` | From the main menu, load a save (the latest by default) |
| `recipes <Skill>` | What a skill can do, with `unlocked` |
| `call <method> [json]` | Send any RPC, e.g. `call skill.start '{"skill":"Mining","recipe":"Stone"}'` |
| `watch` | Print events as they happen |
| `reload` | Hot-reload the runtime |

## Scripts

`run((m) => ...)` connects and hands you `m`:

| | |
|---|---|
| Live state | `m.state` (mode, skills, bank, currencies, active action, combat), pushed whenever it changes (max 4/s) |
| Skills | `m.skills.<name>`: `.level .xp .xpToNext .active .current`, `await .start(recipe)`, `.recipes()` |
| Shortcuts | `m.count(item)`, `m.gp` |
| Actions | `m.stop()` · `m.combat.fight(area, enemy)` · `.stop()` · `.eat()` · `.state .hp .maxHp` |
| Events | `m.on('levelUp' \| 'actionChanged' \| 'modeChanged' \| '*', fn)` · `m.onState(fn)` · `await m.waitFor(s => ...)` |
| Misc | `m.log(...)` (also shown in the game log) · `m.loadSave()` |

Typed ids (from `bun run gen:ids`, read straight from your installed game):
- `Skills`, `Items`, `Enemies`, `CombatAreas`, `Currencies`, `AreaEnemies`
- one recipe map per skill: `WoodcuttingRecipes`, `MiningRecipes`, `FishingRecipes`, `SmithingRecipes`,
  `CookingRecipes`, `FiremakingRecipes`, `CraftingRecipes`, `FletchingRecipes`, `RunecraftingRecipes`,
  `HerbloreRecipes`, `BeastcraftingRecipes`, `FarmingRecipes`, `ThievingRecipes`

Hovering an id in VS Code shows its in-game name.

**An `async` main ends when it resolves.** A plain main (a `setInterval` loop) runs until Ctrl+C. Either way, the
character keeps doing its last action afterwards: it's an idle game.

### Rules

- **Actions run in real time**, exactly as if you'd clicked: a script picks what to do, the game decides how fast.
- **One switch per second.** Calls that change the active action (`skill.start`, `combat.fight`) are limited to one
  per second (`COOLDOWN`, which `start()` waits out by itself).
  - Faster than that is pointless in real time.
  - Each switch also updates the game's online "N players training this action" counter, which other players see.
- **Starting the current recipe does nothing.** The game's own buttons toggle; ours don't.
- **The runtime checks requirements.** The game only checks them in the UI, so the runtime does it for you:
  `LOCKED`, `MISSING_ITEMS`, `NOT_FOUND`.
- **60 calls per second per script** (`RATE_LIMITED`).
- **Supported skills:** Woodcutting, Mining, Fishing, and every crafting skill (Smithing, Cooking, Firemaking, Crafting,
  Fletching, Runecrafting, Herblore, Beastcrafting). Others return `UNSUPPORTED` for now.

## Working on the mod

- `bun run dev` = build + install + `melvor2 reload`: the C# runtime is swapped inside the running game (no restart).
- Changes to `mod/bridge` or `mod/bootstrap` need a game restart; the installer says so.
- `bun run typecheck` covers the client, tools and examples.

```
mod/loader/     loader.gd (the autoload)
mod/bridge/     bridge.c (GDExtension -> hostfxr)
mod/bootstrap/  loads the runtime into a collectible context that shares the game's assemblies
mod/runtime/    the in-game server: WsServer, GameApi (game access), ModEntry (RPC table, pacing, state push)
src/            TypeScript client (client/), CLI (cli/), protocol + generated ids (shared/)
tools/          build, install, gen-ids (+ gamedata.ts: reads the game's embedded PCK), pck.py
examples/       demo scripts; scripts/ is gitignored for your own
```

## Not done yet

- **Pacing model.** Real time only so far. The Melvor 1 "Scripted Mode" (one action, then a cooldown of action time ÷ speed) and a fast-forward mode are options, see RESEARCH.md.
- **More skills:** Thieving, Agility, Astrology, Farming, Ranching, Hunting adapters.
- **More systems:** bank selling, shop, equipment, food selection, slayer.
- **In-game panel** (status, connected scripts, stop button). Today it only writes to the log.
- **An `eval`/inspect tool** for poking at the game from the REPL.
- **Port the docs site** and release tooling from melvor-script.
