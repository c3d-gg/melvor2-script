// Build-time paths. Game/user paths live in src/cli/paths.ts (the CLI needs them too).
import { join } from 'node:path';

export * from '../src/cli/paths.ts';

export const ROOT = join(import.meta.dir, '..');
export const DIST = join(ROOT, 'dist');

export const DOTNET = process.env.DOTNET ?? join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'dotnet', 'dotnet.exe');

/** clang from llvm-mingw (winget MartinStorsjo.LLVM-MinGW.UCRT); any mingw-w64 clang/gcc works. */
export const CC = process.env.CC ?? 'clang';
