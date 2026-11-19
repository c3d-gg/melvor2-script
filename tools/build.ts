// Builds the mod into dist/: the native bridge (C) and the managed bootstrap + runtime (C#).
//   bun run build          build
//   bun run pack           build, stage dist/mod/ and zip it as dist/melvor2-script.zip (what a release ships)
// Needs the installed game: the runtime compiles against its assemblies (which can't be redistributed,
// so releases are built on a machine with the game, not in CI).
import { $ } from 'bun';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CC, DIST, DOTNET, GAME_DATA_DIR, GAME_DIR, ROOT } from './paths.ts';
import { stage } from './stage.ts';

if (!existsSync(join(GAME_DATA_DIR, 'GamesByMalcs.Melvor2.dll'))) {
  console.error(`Melvor Idle 2 not found at ${GAME_DIR} (set MELVOR2_DIR). The runtime compiles against the installed game.`);
  process.exit(1);
}
if (!existsSync(DOTNET)) {
  console.error(`.NET 10 SDK not found at ${DOTNET} (set DOTNET). Install: dotnet-install.ps1 -Channel 10.0`);
  process.exit(1);
}
mkdirSync(join(DIST, 'managed'), { recursive: true });

console.log('bridge (C) ...');
await $`${CC} -shared -O2 -Wall -Wextra -static -o ${join(DIST, 'melvor_script_bridge.dll')} ${join(ROOT, 'mod', 'bridge', 'bridge.c')}`;

const version = (await Bun.file(join(ROOT, 'package.json')).json()).version as string;
const env = { ...process.env, DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' };
for (const proj of ['bootstrap/MelvorScript.Bootstrap.csproj', 'runtime/MelvorScript.Runtime.csproj']) {
  console.log(`${proj} ...`);
  await $`${DOTNET} build ${join(ROOT, 'mod', proj)} -c Release -o ${join(DIST, 'managed')} -p:GameDir=${GAME_DIR} -p:Version=${version} -v:q -nologo`.env(env);
}
console.log('built into dist/');

if (process.argv.includes('--pack')) {
  const dir = stage();
  const zip = join(DIST, 'melvor2-script.zip');
  rmSync(zip, { force: true });
  // Windows' own bsdtar writes zips (-a picks the format from the extension); Git Bash's tar can't.
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  await $`${tar} -a -c -f ${zip} -C ${dir} .`;
  console.log(`packed ${zip}`);
}
