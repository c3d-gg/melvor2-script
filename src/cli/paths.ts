// Where the game and the mod live on this PC. Override with env vars when your setup differs.
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The installed game (Steam). */
export const GAME_DIR = process.env.MELVOR2_DIR ?? 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Melvor Idle 2';
export const GAME_DATA_DIR = join(GAME_DIR, 'data_GamesByMalcs.Melvor2_windows_x86_64');

/** Godot's user:// for the game (custom user dir "Games By Malcs/Melvor Idle 2"). */
export const USER_DIR =
  process.env.MELVOR2_USER_DIR ??
  join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Games By Malcs', 'Melvor Idle 2');

/** Our files inside user:// (loader.gd, bridge, managed dlls, logs). */
export const MOD_DIR = join(USER_DIR, 'melvor-script');

/** The one file the mod adds to the game folder. */
export const OVERRIDE_CFG = join(GAME_DIR, 'override.cfg');
export const OVERRIDE_MARKER = '; melvor-script';

/** The files a release ships and the installer copies into MOD_DIR. */
export const MOD_FILES = [
  'loader.gd',
  'melvor_script_bridge.dll',
  'MelvorScript.Bootstrap.dll',
  'MelvorScript.Bootstrap.runtimeconfig.json',
  'MelvorScript.Bootstrap.deps.json',
  'MelvorScript.Runtime.dll',
] as const;

export const REPO = 'c3d-gg/melvor2-script';
export const REPO_URL = `https://github.com/${REPO}`;
