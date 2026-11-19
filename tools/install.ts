// Installs, removes or checks the mod.
//   bun run install-mod     copy dist/ + loader into user://melvor-script, add override.cfg to the game folder
//   bun run uninstall-mod   remove override.cfg (only if it's ours) and user://melvor-script
//   bun run mod-status      show what's installed and the last logs
//
// Files inside the game folder: only override.cfg. Steam's "verify files" leaves it alone; delete it to disable.
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DIST, GAME_DIR, MOD_DIR, OVERRIDE_CFG, OVERRIDE_MARKER, ROOT } from './paths.ts';

const OVERRIDE = `${OVERRIDE_MARKER} loader. Godot reads override.cfg next to the exe at boot (the game never
; writes this copy). Delete this file to turn melvor-script off. Uninstall: bun run uninstall-mod
[autoload]

MelvorScriptLoader="*user://melvor-script/loader.gd"
`;

const FILES: [from: string, to: string][] = [
  [join(ROOT, 'mod', 'loader', 'loader.gd'), 'loader.gd'],
  [join(DIST, 'melvor_script_bridge.dll'), 'melvor_script_bridge.dll'],
  ...['MelvorScript.Bootstrap.dll', 'MelvorScript.Bootstrap.runtimeconfig.json', 'MelvorScript.Bootstrap.deps.json', 'MelvorScript.Runtime.dll'].map(
    (f): [string, string] => [join(DIST, 'managed', f), f],
  ),
];

function ours(): boolean {
  return existsSync(OVERRIDE_CFG) && readFileSync(OVERRIDE_CFG, 'utf8').startsWith(OVERRIDE_MARKER);
}

function install() {
  for (const [from] of FILES) if (!existsSync(from)) throw new Error(`missing ${from}: run \`bun run build\` first`);
  if (!existsSync(GAME_DIR)) throw new Error(`game not found at ${GAME_DIR} (set MELVOR2_DIR)`);
  if (existsSync(OVERRIDE_CFG) && !ours())
    throw new Error(`${OVERRIDE_CFG} exists and isn't ours. Merge this in by hand:\n${OVERRIDE}`);

  mkdirSync(MOD_DIR, { recursive: true });
  for (const [from, to] of FILES) {
    const dest = join(MOD_DIR, to);
    if (existsSync(dest) && readFileSync(dest).equals(readFileSync(from))) continue; // unchanged
    try {
      copyFileSync(from, dest);
      console.log(`  ${to}`);
    } catch (e) {
      // The bridge and bootstrap stay locked while the game runs; the runtime is loaded from bytes and isn't.
      if ((e as NodeJS.ErrnoException).code === 'EBUSY' || (e as NodeJS.ErrnoException).code === 'EPERM')
        console.warn(`  ${to}: in use by the running game, kept the old copy (restart the game, then install again)`);
      else throw e;
    }
  }
  writeFileSync(OVERRIDE_CFG, OVERRIDE);
  console.log(`  ${OVERRIDE_CFG}`);
  console.log('Installed. Restart Melvor Idle 2 to load it.');
}

function uninstall() {
  if (ours()) {
    rmSync(OVERRIDE_CFG);
    console.log(`removed ${OVERRIDE_CFG}`);
  } else if (existsSync(OVERRIDE_CFG)) console.warn(`${OVERRIDE_CFG} isn't ours; left it alone`);
  if (existsSync(MOD_DIR)) {
    try {
      rmSync(MOD_DIR, { recursive: true });
      console.log(`removed ${MOD_DIR}`);
    } catch {
      console.warn(`couldn't remove ${MOD_DIR} (the game has files open). Close the game and run this again.`);
    }
  }
}

function status() {
  console.log(`game dir     ${GAME_DIR}`);
  console.log(`override.cfg ${existsSync(OVERRIDE_CFG) ? (ours() ? 'installed' : 'present, NOT ours') : 'missing (mod is off)'}`);
  console.log(`mod dir      ${MOD_DIR}${existsSync(MOD_DIR) ? '' : ' (missing)'}`);
  for (const [, to] of FILES) {
    const p = join(MOD_DIR, to);
    console.log(`  ${existsSync(p) ? statSync(p).mtime.toISOString() : 'missing                 '}  ${to}`);
  }
  for (const log of ['loader.log', 'bridge.log', 'bootstrap.log', 'runtime.log']) {
    const p = join(MOD_DIR, log);
    if (!existsSync(p)) continue;
    console.log(`\n--- ${log}`);
    console.log(readFileSync(p, 'utf8').trimEnd().split('\n').slice(-15).join('\n'));
  }
}

const cmd = process.argv[2];
if (cmd === 'install') install();
else if (cmd === 'uninstall') uninstall();
else if (cmd === 'status') status();
else {
  console.error('usage: bun tools/install.ts install|uninstall|status');
  process.exit(1);
}
