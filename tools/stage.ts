// Gathers the files a mod install needs (see MOD_FILES) into dist/mod/.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DIST, MOD_FILES, ROOT } from './paths.ts';

const SOURCES: Record<(typeof MOD_FILES)[number], string> = {
  'loader.gd': join(ROOT, 'mod', 'loader', 'loader.gd'),
  'melvor_script_bridge.dll': join(DIST, 'melvor_script_bridge.dll'),
  'MelvorScript.Bootstrap.dll': join(DIST, 'managed', 'MelvorScript.Bootstrap.dll'),
  'MelvorScript.Bootstrap.runtimeconfig.json': join(DIST, 'managed', 'MelvorScript.Bootstrap.runtimeconfig.json'),
  'MelvorScript.Bootstrap.deps.json': join(DIST, 'managed', 'MelvorScript.Bootstrap.deps.json'),
  'MelvorScript.Runtime.dll': join(DIST, 'managed', 'MelvorScript.Runtime.dll'),
};

export function stage(): string {
  const dir = join(DIST, 'mod');
  mkdirSync(dir, { recursive: true });
  for (const f of MOD_FILES) copyFileSync(SOURCES[f], join(dir, f));
  return dir;
}
