# Melvor Idle 2: scripting-mod research

Findings from 2026-11-19, game build **0.11.6-alpha.1** (Steam app 3218350, early access since 2026-11-17).
Goal: port [melvor-script](../melvor-scripting-mod) (TypeScript scripts drive the game over a local WebSocket) to Melvor 2.

**Verdict: works.** There's no mod loader yet (official mod support is announced as "coming soon"), but the game is
readable C#, ships no anti-cheat, and Godot offers a clean way in. The injection chain below was **verified in the real
game on 2026-11-19**: loader, bridge, bootstrap, runtime, live state, skill/crafting actions, combat checks and hot
reload. The working code is in `mod/`; see README.md for how to use it.

## The game

| | |
|---|---|
| Engine | Godot **4.7.2** .NET (`stable.mono.official`), C# on **.NET 10** (self-contained, `data_GamesByMalcs.Melvor2_windows_x86_64/`) |
| Game logic | `GamesByMalcs.Melvor2.dll` (11.7 MB). Decompiles to ~4,000 readable files; only ~35 (cloud/login, folders `A/ B/ c/`) are obfuscated |
| Game data | `res://Data/Packages/MelvorBase.json` (15 MB, namespace `MelvorBase`, 137 object types, 1,811 items, 192 enemies) |
| PCK | embedded in `Melvor2.exe` as PE section `pck` (offset `0x6857c00`, pack format v4), **not encrypted**, no GDScript files |
| User dir | `%APPDATA%\Games By Malcs\Melvor Idle 2\` (logs, device settings). Saves: `steam\<SteamID64>\saves\save_<guid>.sav` (Brotli + BinaryWriter, unsigned) |
| Libraries | Nakama + Satori (Heroic Labs), Steamworks.NET, Serilog, SmartFormat |

### Regenerating the source and data

```sh
# Decompiler: ilspycmd 9.1 works with the installed .NET SDK 9 (11.x needs SDK 10)
dotnet tool install ilspycmd --version 9.1.0.7988 --tool-path .cache/tools
.cache/tools/ilspycmd -p --nested-directories -o .cache/decomp \
  -r "<game>/data_GamesByMalcs.Melvor2_windows_x86_64" "<game>/data_GamesByMalcs.Melvor2_windows_x86_64/GamesByMalcs.Melvor2.dll"
# PCK: list / extract (project.binary, the data package, ...)
PCK_OFFSET=0x6857c00 python -I tools/pck.py "<game>/Melvor2.exe" list
PCK_OFFSET=0x6857c00 python -I tools/pck.py "<game>/Melvor2.exe" extract .cache/pck 'project.binary' 'Data/Packages/*'
```

`<game>` = `C:\Program Files (x86)\Steam\steamapps\common\Melvor Idle 2`. The section offset changes with each build:
find it again from the PE section table (section name `pck`). File references below are relative to
`.cache/decomp/GamesByMalcs/Melvor2/`. Keep decompiled code out of git.

## Getting code into the game (verified 2026-11-19)

There's no `Assembly.Load`, mod folder or plugin hook in the game. Godot gives a way in:

1. **`override.cfg` next to `Melvor2.exe`.** Godot reads it at boot and it can add autoloads. The game never writes this copy.
   (`project.binary` also sets `application/config/project_settings_override = user://device_settings/override.cfg`,
   but the game rewrites that file whole whenever the window moves/resizes, `LocalSettingsManager.cs:150-158`.)
   ```ini
   [autoload]
   MelvorScriptLoader="*user://melvor-script/loader.gd"
   ```
2. **GDScript autoload** in `user://melvor-script/`. The export includes GDScript and `GDExtensionManager` (checked
   in the exe). It calls `GDExtensionManager.load_extension(...)` on a tiny native bridge.
3. **Native bridge** (`mod/bridge/bridge.c`, ~150 lines, llvm-mingw clang). It takes the `hostfxr.dll` already in
   the process and opens a secondary context with `hostfxr_initialize_for_runtime_config`. That returns `0x1`
   (already initialized): the self-contained app's `includedFrameworks` satisfies our framework-dependent
   runtimeconfig. Then `hdt_load_assembly_and_get_function_pointer` → `MelvorScript.Bootstrap.Entry.Init`
   (`[UnmanagedCallersOnly]`). The fallback is `get_runtime_delegate(NULL)` (the active context); it was never needed.
4. **Bootstrap** (`mod/bootstrap`). It starts in its own `IsolatedComponentLoadContext`. **The game itself also lives in
   an isolated context** (`IsolatedComponentLoadContext(...GamesByMalcs.Melvor2.dll)`), not the default one. The
   bootstrap creates a *collectible* context whose `Load` borrows from the game's context (shared types) and loads the
   runtime from bytes. That gives hot reload (`runtime.reload` → stop → unload → load the new dll) without a restart.
5. **C# runtime** (`mod/runtime`): compiled against the installed `GamesByMalcs.Melvor2.dll` + `GodotSharp.dll`
   (Private=false). It runs on Godot's main thread via `SceneTree.ProcessFrame += Pump`. The WebSocket server is
   `TcpListener` + `WebSocket.CreateFromStream` (no http.sys/urlacl). Building it needs the **.NET 10 SDK**
   (10.0.404, installed user-local in `%LOCALAPPDATA%\Microsoft\dotnet`). Harmony isn't used yet; 2.4.2 supports .NET 10
   if patches are needed.

Plan B, never needed: a proxy DLL (e.g. `version.dll`) in the game folder that waits for CoreCLR and does step 3.

Files that stay locked while the game runs: `melvor_script_bridge.dll` and `MelvorScript.Bootstrap.dll` (restart to
update them). The runtime is loaded from bytes and can always be replaced.

## Driving the game (the API the C# runtime would wrap)

- **Root:** no singleton. `((GetTree().CurrentScene as Main)?.State as IGameState)?.Game` (`Main.cs:253, 838-854`,
  `IGameState.cs`). Check `State.Mode == ApplicationMode.Game` (the DataEditor builds its own `Game`) and
  `Game.IsSaveLoaded` / `SaveLoaded` (`Game.cs:174,182`).
- **Entities** by id: `game.Entities.GetObjectById("MelvorBase:Woodcutting")` (`Data/DataRegistry.cs:53,67`); typed
  properties like `WoodcuttingEntity.Action`, `.Experience`. Data objects: `game.Data.GetObject<WoodcuttingRecipe>("MelvorBase:NormalTree")`.
- **Tick:** `GameDriver._PhysicsProcess` → `Game.PropagateTick()` at 60 Hz (`GameDriver.cs:152`, `Game.cs:219`). No
  global tick event: patch `PropagateTick` or add our own Node. Offline progress pauses the tree and calls
  `PropagateTick` in a loop **on a worker thread** (`Main.cs:507-593`), so don't touch `Game` while it runs.
- **One active action** like Melvor 1: `ActiveActionManager` (`ActionStarted/ActionStopped`, `TryStopActive`);
  `ActionComponent.TryStart/TryStop/QueueOrTryStop`. Starting one stops the other.
  - Woodcutting: `Action.Trees[recipe]` → `Action.SelectTree(tree)` (toggles/switches), `Action.TryStop()`.
  - Artisan (Smithing, Crafting, Fletching, Runecrafting, ... all `ArtisanRecipe`): `SelectCategory` → `SelectRecipe` →
    `StartCreating()` (or `UntilX.StartCreating()`).
  - Agility `SelectCourse`, Thieving `TryStartActiveRecipe`, Astrology `StudyConstellation`.
  - **Level requirements are checked only in the UI** (e.g. `WoodcuttingTreeView.cs:319`): the runtime must check
    `recipe.Requirements.AreMet` itself, or scripts could skip level locks.
- **Bank:** `MelvorBase:Bank` → `Inventory.GetQuantity/ItemQuantityChanged`, `Wallet.GetQuantity("MelvorBase:GoldPieces")`,
  `ItemSales.SellItem(item, stats, qty)` (call `stats.Destroy()` after).
- **Combat:** `MelvorBase:Combat` → `Areas.SelectEnemy(area, enemy)` auto-starts; `Action.TryStop()`; `Food.SelectFood` +
  `ManualEat()`; `Player.Health`; `Enemy.Killed`, `Action.PlayerDied`.
- **Farming:** `Passive.ActivePlots[plot]` → `SelectRecipe/Plant/Harvest/Compost/Water`. Shop: `ProcessPurchase(purchase, qty)`.
  Quests: `game.Quests.Quests`.
- **Events:** the EventBus has only 4 channels (ActionPerformed, FoodEaten, PetUnlocked, ToolbeltItemConsumed). The
  useful ones are plain C# events: `ExperienceComponent.LevelChanged/XpChanged`, `Inventory.ItemQuantityChanged`,
  `TreeCut`, `RecipeCreated`, `Enemy.Killed`, `ItemSold`, and `game.EventLog.EntryAdded`.

### Pacing (the old "Scripted Mode")

No instant-actions mode and no gamemodes (`GamemodeSelectionView.cs:113` builds one panel + "Coming soon"; the save
header's gamemode is hard-coded `"Test"`). Options:
- real time (default): scripts start actions, the game's interval applies;
- old model: after each `ActionPerformed`, queue a stop, and shorten intervals via the existing
  `GlobalPercentActionInterval` modifier path (interval = `floor((base + flat) * (1 + percent))`), so speed 10 = −90%;
- whole-game fast-forward: extra `PropagateTick()` calls per frame, the same thing offline progress does. Note that
  `Constants.TicksPerSecond` is not a speed knob (it rescales ms→tick conversion too).

Since there are no gamemodes yet, scripting has to be opted into per save (keyed by save GUID).

## Online surface (what other players or the devs see)

- **Nakama:** Melvor Cloud login, cloud saves (owner-only storage) + 5 backups, a remote config object, Patreon/news,
  bank-layout share codes, and **presence streams**: "N other players training this action" (`PresenceFooterView.cs`).
  No leaderboards, chat, trading, groups or matches.
- **Satori:** logged into, nothing else (no events/flags/telemetry calls in the client).
- **No anti-cheat:** no assembly/debugger/tamper checks, no save signing, no cheat flag in the save header.
- **Offline works:** "skip login" leaves no Nakama session (no presence, no cloud upload). Steam is required (save path
  uses the SteamID) and Steam Cloud still mirrors local saves.
- For the mod: a script that switches actions often sends a presence leave/join each time and skews the counts other
  players see. Throttle or suppress that (patch the readable `PresenceManager`, not the obfuscated client).

## Extras found

- A **full cheat menu** (`GameMenus/DebugPopup/DebugMenu.cs`: add items/XP/levels, run N offline hours, complete
  quests...) and a **DataEditor** application mode ship in the build. Neither is reachable (the button is hidden at
  `MainMenu/MainMenuView.cs:179`; `open_debug_menu` is bound to the backtick key in project.binary but not handled).
  Useful as dev tools for testing the mod.
- `deviceSettings.json` → `Debug.LoadLocalDataPackages: true` loads `user://local_data/MelvorBase.json` instead of the
  built-in one (whole-file replace). New namespaces need code (`Game.cs:461`).
- `DataNamespace.IsModded` exists but is unused, a sign that mod support is planned.

## What carries over from melvor-script

| Keep | Rewrite |
|---|---|
| TypeScript client SDK (`run`, pacing, events, `m.state`), WebSocket JSON-RPC protocol + error codes, token auth, CLI (`init/status/repl/watch`), docs site + generators, release tooling, typed id generation (from `MelvorBase.json`) | game-side runtime (JS → C#: server, RPC, pacing, per-skill adapters, in-game panel), `eval` (C# has no `eval`: a reflection/inspect RPC or Roslyn), the fake-game tests (Melvor 2's `Game` needs the Godot engine) |

Melvor 2 adds Ranching, Hunting and Beastcrafting, and uses a Mastery Guild instead of per-action mastery.

### Found while building

- **Woodcutting ids aren't Melvor 1's:** `WoodDebris`, `FortressWall1`, `TreantRemains`, ... (22 entries, from
  `EntityConfig["MelvorBase:Woodcutting"].Recipes`). Use the generated ids.
- **Recipe names:** recipes don't override `ToString()`. The name is `INamedObject.DisplayName` (an
  `ILocalizedString`; `.Text`, or `PluralString.Singular` for items).
- **Combat areas** use `UnlockRequirements`, not `Requirements`.
- **`EntityConfig` lists hold `{ Priority, Id }` objects**, not plain ids.
- **Getting to the menu's view:** `IApplicationState` has no `View`, but the concrete state does (reflection).
  Loading a save from the main menu = `SaveManager.SetActiveSaveId(id, source)` + the view's protected
  `OnModeChangeRequested(new ApplicationModeEventArgs(ApplicationMode.Game))`.
- **Closing the game cleanly:** `Process.CloseMainWindow()` saves locally, syncs the cloud and logs out cleanly, with
  or without the mod loaded.

## Risks / open questions

- Early access: expect breakage on patches. Never depend on obfuscated names (`A.t`, ...), which change per build.
- Official mod support may arrive in a different shape (language, sandbox). Keep the C# runtime a thin layer under the
  protocol so the client survives a move to the official API.
- Melvor 2 is a licensed RuneScape game: keep scripting single-player, away from cloud/network code.
