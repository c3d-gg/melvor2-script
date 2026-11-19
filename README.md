# melvor2-script

Turn **Melvor Idle 2** into a programming game, like [melvor-script](https://github.com/c3d-gg/melvor-script) did for
Melvor 1. A mod runs a local server inside the game; your TypeScript scripts (Bun, VS Code) are the client.

```ts
import { run, Items, WoodcuttingRecipes } from 'melvor2-script';

// Real time: pick what the character does, the game decides how fast.
run(async (m) => {
  await m.skills.woodcutting.start(WoodcuttingRecipes.NormalTree);
  await m.waitFor(() => m.count(Items.NormalLog) >= 5000);
  m.log('5000 logs!');
});
```

```ts
// Scripted Mode (the Melvor 1 rules): every act() happens at once, then a cooldown of action time ÷ speed.
import { run, MiningRecipes } from 'melvor2-script';

run((m) => {
  setInterval(() => {
    if (!m.ready) return;
    m.skills.mining.act(MiningRecipes.Stone);
  }, 50);
});
```

**[Docs](https://c3d-gg.github.io/melvor2-script/)**: quick start, a course for people new to coding, guides and the
full reference.

> **Early days.** Melvor Idle 2 is in early access (tested on 0.11.6-alpha, Steam on Windows) and has no official mod
> API yet. This mod works with the game's internals, so a game update can break it until the mod is updated. How it gets
> in and what we know about the game is in [RESEARCH.md](RESEARCH.md).

## Setup

You need [Bun](https://bun.com) and Melvor Idle 2 on Steam (Windows).

```sh
mkdir my-melvor2-scripts && cd my-melvor2-scripts
bun init -y
bun add github:c3d-gg/melvor2-script#v0.1.0
bunx melvor2 install     # downloads the mod files for this version and installs them into the game
bunx melvor2 init        # scripts/hello.ts, tsconfig.json, VS Code F5 setup (never overwrites)
```

Restart Melvor Idle 2 and load a save, then run `bun scripts/hello.ts` (or open it in VS Code and press **F5**, with the
Bun extension). `bunx melvor2 status` shows the versions on both sides.

- The only file added to the game folder is `override.cfg`. Delete it to turn the mod off, or run
  `bunx melvor2 uninstall` to remove everything.
- Everything else goes in `%APPDATA%\Games By Malcs\Melvor Idle 2\melvor-script\`, along with the logs.
  `bunx melvor2 mod-status` shows the end of each log.
- **Updating:** `bun add github:c3d-gg/melvor2-script#vX.Y.Z`, then `bunx melvor2 install` again (close the game
  first).
- Other install locations: set `MELVOR2_DIR` (game folder) or `MELVOR2_USER_DIR`.

## Two ways to play

**Real time (default).** `start(recipe)` repeats like a click until something else starts.

- At most one action switch per second. `start()` waits that out by itself. Faster is pointless in real time, and
  each switch also updates the game's online "N players training this action" counter.
- Starting the current recipe does nothing.

**Scripted Mode** (opt in per save): the Melvor 1 melvor-script rules. Cheaty, but fun, and up to you.

```sh
bunx melvor2 scripted on   # for the loaded save; `off` to go back
bunx melvor2 speed 50      # 1..1000, default 10, shared by all Scripted saves
```

- **Every `act()` happens at once:** one hit on a tree (trees take a few hits per log), one catch, one crafting step.
- **Then a cooldown:** the next action waits _that action's normal time ÷ speed_ (never less than 50 ms). Speed bonuses
  still count.
- **Nothing idles:** nothing repeats on its own, so there's no offline progress for skills. Your own clicks in the game
  become single actions on the same cooldown.
- **Pacing in scripts:** `m.ready`, `m.cooldown` (ms left), `await m.whenReady()`.
  - Calling `act()` while not ready fails at once with `COOLDOWN` (or `BUSY`) without reaching the game, so a
    `setInterval(..., 1)` loop can't spam it.
  - Awaiting `act()` resolves when you may act again, so `while (...) await act(x)` paces itself.
- `act(recipe, { count: n })` does n actions in one call, spaced by the cooldown inside the game. If it ends early (out
  of materials, you clicked something else...) it throws with the partial result in `error.data`, unless you pass
  `allowStop: true`.
- Scripted actions never show up in the game's online presence counter.
- Combat runs in real time in both modes for now. Turn-based Scripted combat (like Melvor 1's `attack()`) is next on
  the roadmap.

## Scripts

`run((m) => ...)` connects and hands you `m`. **An `async` main ends when it resolves**; a plain main (a `setInterval`
loop) runs until Ctrl+C. Either way, the character keeps doing its last action afterwards.

|            |                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live state | `m.state`: mode, skills, bank, currencies, active action, combat, Scripted Mode. Pushed whenever it changes (max 4/s)                                                  |
| Skills     | `m.skills.<name>`: `.level .xp .xpToNext .active .current` · `await .start(recipe)` (real time) · `await .act(recipe, { count, allowStop })` (Scripted) · `.recipes()` |
| Pacing     | `m.scripted m.speed m.ready m.cooldown` · `await m.whenReady()` · `m.setScripted({ on, speed })`                                                                       |
| Shortcuts  | `m.count(item)` · `m.gp`                                                                                                                                               |
| Combat     | `m.combat.fight(area, enemy)` · `.stop()` · `.eat()` · `.state .hp .maxHp`                                                                                             |
| Events     | `m.on('levelUp' \| 'actionChanged' \| 'modeChanged' \| '*', fn)` · `m.onState(fn)` · `await m.waitFor(s => ...)`                                                       |
| Misc       | `m.stop()` · `m.log(...)` (also in the game log) · `m.loadSave()`                                                                                                      |

**Typed ids** are generated from the game's own data: `Skills`, `Items`, `Enemies`, `CombatAreas`, `AreaEnemies`,
`Currencies`, and a recipe map per skill (`WoodcuttingRecipes`, `MiningRecipes`, `FishingRecipes`, `SmithingRecipes`,
`CookingRecipes`, `FiremakingRecipes`, ...). Hover one in VS Code to see its in-game name.

**Supported skills:** Woodcutting, Mining, Fishing, Smithing, Cooking, Firemaking, Crafting, Fletching, Runecrafting,
Herblore, Beastcrafting. The others answer `UNSUPPORTED` for now.

**The runtime checks requirements and materials itself** (the game only checks them in its UI): `LOCKED`,
`MISSING_ITEMS`, `NOT_FOUND`. There's also a limit of 60 calls per second per script (`RATE_LIMITED`).

Examples in [`examples/`](examples):

- `hello.ts`: read state
- `gather-until.ts`: real time
- `scripted-await.ts` and `scripted-loop.ts`: Scripted Mode

## CLI

`bunx melvor2 <command>` (`bun run melvor2 <command>` in a clone):

- **Setup** (no game needed): `init` · `install [version]` · `uninstall` · `mod-status`
- **Game:**
  - `status` · `state` · `saves` · `load-save [id]` · `recipes <Skill>`
  - `scripted [on|off]` · `speed [n]` · `act <Skill> <recipe> [n]`
  - `call <method> [json]` · `watch` · `reload`

## Security

The server listens on 127.0.0.1 only, needs the token from `~/.melvor2-scripting/config.json` (written by the game on
its first start with the mod), and refuses any request carrying an `Origin` header, so web pages can't reach it.

## Working on the mod

From source you need, besides Bun:

- the **.NET 10 SDK**, which can be user-local:
  `dotnet-install.ps1 -Channel 10.0 -InstallDir $env:LOCALAPPDATA\Microsoft\dotnet` (the tools look there; set
  `DOTNET` otherwise)
- a mingw **clang** (`winget install MartinStorsjo.LLVM-MinGW.UCRT`)
- the game installed: the runtime compiles against its assemblies.

```sh
bun install
bun run build && bun run install-mod   # restart the game once after the first install
bun run dev                            # later: build + install + hot-reload the runtime, no restart
```

Changes to `mod/bridge` or `mod/bootstrap` need a game restart. `bun run typecheck` covers the TypeScript;
`bun run gen:ids` regenerates the ids from the installed game.

```
mod/loader/     loader.gd: the autoload that override.cfg starts
mod/bridge/     bridge.c: a GDExtension that loads our .NET code through the game's own hostfxr
mod/bootstrap/  loads the runtime into a collectible context that shares the game's assemblies (hot reload)
mod/runtime/    the in-game server: WsServer, GameApi (game access), Scripted (instant actions), ModEntry (RPC table)
src/            TypeScript client (client/), CLI (cli/), protocol + generated ids (shared/)
tools/          build/pack, install, release, gen-ids (+ gamedata.ts: reads the game's embedded PCK)
site/           the docs site (Astro Starlight); how to write for it: site/CONTRIBUTING.md
examples/       demo scripts; scripts/ is gitignored for your own
```

**Releases** are cut on a machine with the game (CI can't build the runtime): `bun run release --dry-run`, then
`bun run release`. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) and decide the
version (`feat` → minor, `fix` → patch). See [CLAUDE.md](CLAUDE.md).

## License

[MIT](LICENSE)
