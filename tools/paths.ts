// Where things live. Override with env vars when your setup differs.
import { homedir } from 'node:os';
import { join } from 'node:path';

export const ROOT = join(import.meta.dir, '..');
export const DIST = join(ROOT, 'dist');

/** The installed game (Steam). */
export const GAME_DIR = process.env.MELVOR2_DIR ?? 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Melvor Idle 2';
export const GAME_DATA_DIR = join(GAME_DIR, 'data_GamesByMalcs.Melvor2_windows_x86_64');

/** Godot's user:// for the game (custom user dir "Games By Malcs/Melvor Idle 2"). */
export const USER_DIR =
  process.env.MELVOR2_USER_DIR ?? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Games By Malcs', 'Melvor Idle 2');

/** Our files inside user:// (loader.gd, bridge, managed dlls, logs). */
export const MOD_DIR = join(USER_DIR, 'melvor-script');

/** The one file we add to the game folder. */
export const OVERRIDE_CFG = join(GAME_DIR, 'override.cfg');
export const OVERRIDE_MARKER = '; melvor-script';

export const DOTNET = process.env.DOTNET ?? join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'dotnet', 'dotnet.exe');

/** clang from llvm-mingw (winget MartinStorsjo.LLVM-MinGW.UCRT); any mingw-w64 clang/gcc works. */
export const CC = process.env.CC ?? 'clang';
