// In a clone: install, remove or check the mod built into dist/.
//   bun run install-mod     copy dist/ + the loader into the game's user folder, add override.cfg
//   bun run uninstall-mod   remove override.cfg (only if it's ours) and the mod folder
//   bun run mod-status      show what's installed and the last lines of each log
// Projects that installed the package use `bunx melvor2 install`, which downloads a release instead.
import { installFrom, status, uninstall } from '../src/cli/modfiles.ts';
import { stage } from './stage.ts';

const cmd = process.argv[2];
try {
  if (cmd === 'install') installFrom(stage());
  else if (cmd === 'uninstall') uninstall();
  else if (cmd === 'status') status();
  else throw new Error('usage: bun tools/install.ts install|uninstall|status');
} catch (e) {
  console.error((e as Error).message.includes('ENOENT') ? `${(e as Error).message}\nRun \`bun run build\` first.` : (e as Error).message);
  process.exit(1);
}
