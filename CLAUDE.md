# melvor2-script

Melvor Idle 2 as a programming game: a mod runs a WebSocket JSON-RPC server inside the game (Godot 4.7 + .NET 10), and
TypeScript scripts (Bun) are the client. Port of melvor-script for Melvor 1 (c3d-gg/melvor-script). README.md is the
user manual; RESEARCH.md has what we know about the game's internals; the docs site (`site/`) is the user-facing manual.

## Layout

- `mod/loader` (GDScript autoload) → `mod/bridge` (C GDExtension → hostfxr) → `mod/bootstrap` (collectible load
  context) → `mod/runtime` (C#: server, game access, Scripted Mode). `src/` is the TypeScript client, CLI and protocol.
- The runtime compiles against the **installed game's** `GamesByMalcs.Melvor2.dll` (`mod/Directory.Build.props`,
  `GameDir`). It can't be built in CI and the game's assemblies must never be committed. Releases are built locally.

## Commands

```sh
bun run typecheck        # client, CLI, tools, examples
bun fmt                  # formatter (bunfig.toml); CI runs `bun fmt --check`
bun run build            # dist/: bridge + bootstrap + runtime (needs the game + .NET 10 SDK + mingw clang)
bun run dev              # build + install + hot-reload the runtime into the running game
bun run install-mod      # install dist/ into the game (override.cfg + %APPDATA%\Games By Malcs\Melvor Idle 2\melvor-script)
bun run mod-status       # installed files + last lines of every log
bun run gen:ids          # regenerate src/shared/ids.generated.ts from the installed game's data
bun run melvor2 <cmd>    # CLI (status, state, scripted, act, call, ...)
cd site && bun run dev   # docs site at http://localhost:4321/melvor2-script/
```

Changes to `mod/bridge` or `mod/bootstrap` need a game restart; the runtime hot-reloads (`bun run dev`).

## Conventions

- Commit messages follow Conventional Commits; they decide the next version (`feat` minor, `fix` patch). The version
  lives only in package.json. Never bump it by hand: `bun run release` does it.
- Read the decompiled game code before calling into it (RESEARCH.md says how to decompile). Note file:line facts you
  rely on in RESEARCH.md. Never depend on obfuscated names (`A.*`, `B.*`, `c.*`): they change every build.
- Game calls run on the main thread only (`MainThread.Run` / frame handlers). Network threads never touch the game.
- **Pacing rules.** Real time: action switches are limited to one per second, because each one updates the game's
  online presence counter that other players see. Scripted Mode: start → fire → stop happens inside one frame, so
  presence never sees it. Keep it that way, and never add an action path that skips the cooldown.
- The game only checks requirements in its UI: every action path checks `Requirements` (LOCKED) and materials
  (MISSING_ITEMS) itself.
- Never print or commit the token in `~/.melvor2-scripting/config.json`, `data/jwt.dat`, or anything under `.cache/`
  (save backups, decompiled code).
- **The user plays on their own save.** Ask before restarting the game or running anything that changes what their
  character does. Close the game only with a graceful close (`CloseMainWindow`), never kill it, and back up saves
  first. Never start real combat on their save without asking.

## Done means documented

A feature isn't finished until the docs are. For every change to the public API (`src/client/`, `src/shared/protocol.ts`):

1. Doc comments on every new public call, property and type. They become the reference and the VS Code hovers.
2. The guide for that game system shows the new calls, with code in `site/snippets/`. Run the `/docs` skill to find
   and draft what's missing.
3. `site/roadmap.json` moves a shipped item from `next` to `available`.
4. `bun run docs` (regenerates docs/API.md), `bun run docs:site --check`, `bun run typecheck` and a site build
   (`cd site && bun run build`) pass.

Where things go and how to write them: `site/CONTRIBUTING.md`.

## Releasing

1. Push to main and wait for CI.
2. On the machine with the game: `bun run release --dry-run`, then `bun run release` (picks the version from the
   commits, writes CHANGELOG.md, runs the checks, builds and packs the mod, tags, pushes, creates the GitHub release
   with the zip and the loose mod files that `bunx melvor2 install` downloads).
3. Write player-facing patch notes into the release body (`gh release edit vX.Y.Z --notes-file notes.md`).
4. The docs site deploys itself when the release is published (`.github/workflows/pages.yml`). Docs fixes in between:
   `gh workflow run pages.yml -f ref=main`.
