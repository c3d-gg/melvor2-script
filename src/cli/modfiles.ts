// Installing, removing and checking the mod files. Used by `bunx melvor2 install` (files downloaded
// from a GitHub release) and by `bun run install-mod` in a clone (files built into dist/).
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GAME_DIR, MOD_DIR, MOD_FILES, OVERRIDE_CFG, OVERRIDE_MARKER, REPO_URL } from './paths.ts';

const OVERRIDE = `${OVERRIDE_MARKER} loader. Godot reads override.cfg next to the exe at boot (the game never
; writes this copy). Delete this file to turn melvor2-script off. Uninstall: bunx melvor2 uninstall
[autoload]

MelvorScriptLoader="*user://melvor-script/loader.gd"
`;

function overrideIsOurs(): boolean {
  return existsSync(OVERRIDE_CFG) && readFileSync(OVERRIDE_CFG, 'utf8').startsWith(OVERRIDE_MARKER);
}

/** Copy the mod files from `sourceDir` into the game's user folder and add override.cfg. */
export function installFrom(sourceDir: string): void {
  for (const f of MOD_FILES) if (!existsSync(join(sourceDir, f))) throw new Error(`missing ${join(sourceDir, f)}`);
  if (!existsSync(GAME_DIR))
    throw new Error(`Melvor Idle 2 not found at ${GAME_DIR} (set MELVOR2_DIR to your game folder)`);
  if (existsSync(OVERRIDE_CFG) && !overrideIsOurs())
    throw new Error(`${OVERRIDE_CFG} exists and isn't ours. Merge this into it by hand:\n${OVERRIDE}`);

  mkdirSync(MOD_DIR, { recursive: true });
  let restart = false;
  for (const f of MOD_FILES) {
    const from = join(sourceDir, f);
    const dest = join(MOD_DIR, f);
    if (existsSync(dest) && readFileSync(dest).equals(readFileSync(from))) continue; // unchanged
    try {
      copyFileSync(from, dest);
      console.log(`  ${f}`);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      // The bridge and bootstrap stay locked while the game runs; the runtime is loaded from bytes and isn't.
      if (code !== 'EBUSY' && code !== 'EPERM') throw e;
      console.warn(`  ${f}: in use by the running game, kept the old copy (close the game and install again)`);
      restart = true;
    }
  }
  writeFileSync(OVERRIDE_CFG, OVERRIDE);
  console.log(`  ${OVERRIDE_CFG}`);
  console.log(
    restart ? 'Partly installed: close the game and run this again.' : 'Installed. (Re)start Melvor Idle 2 to load it.',
  );
}

/** Download the mod files of release `vX.Y.Z` and install them. */
export async function installRelease(version: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'melvor2-script-'));
  try {
    console.log(`Downloading melvor2-script v${version} from ${REPO_URL}/releases ...`);
    for (const f of MOD_FILES) {
      const url = `${REPO_URL}/releases/download/v${version}/${f}`;
      const res = await fetch(url);
      if (!res.ok)
        throw new Error(
          `${url} → ${res.status}. Is v${version} released? (Or build it yourself: clone the repo, bun run build && bun run install-mod)`,
        );
      await Bun.write(join(dir, f), res);
    }
    installFrom(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function uninstall(): void {
  if (overrideIsOurs()) {
    rmSync(OVERRIDE_CFG);
    console.log(`removed ${OVERRIDE_CFG}`);
  } else if (existsSync(OVERRIDE_CFG)) console.warn(`${OVERRIDE_CFG} isn't ours; left it alone`);
  if (!existsSync(MOD_DIR)) return;
  try {
    rmSync(MOD_DIR, { recursive: true });
    console.log(`removed ${MOD_DIR}`);
  } catch {
    console.warn(`couldn't remove ${MOD_DIR} (the game has files open). Close the game and run this again.`);
  }
}

/** What's installed, and the end of each log. */
export function status(): void {
  console.log(`game dir     ${GAME_DIR}`);
  console.log(
    `override.cfg ${existsSync(OVERRIDE_CFG) ? (overrideIsOurs() ? 'installed' : 'present, NOT ours') : 'missing (the mod is off)'}`,
  );
  console.log(`mod dir      ${MOD_DIR}${existsSync(MOD_DIR) ? '' : ' (missing)'}`);
  for (const f of MOD_FILES) {
    const p = join(MOD_DIR, f);
    console.log(`  ${existsSync(p) ? statSync(p).mtime.toISOString() : 'missing                 '}  ${f}`);
  }
  for (const log of ['loader.log', 'bridge.log', 'bootstrap.log', 'runtime.log']) {
    const p = join(MOD_DIR, log);
    if (!existsSync(p)) continue;
    console.log(`\n--- ${log}`);
    console.log(readFileSync(p, 'utf8').trimEnd().split('\n').slice(-15).join('\n'));
  }
}
