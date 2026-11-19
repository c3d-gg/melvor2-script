// Reads files out of Melvor2.exe's embedded Godot PCK (PE section "pck", pack format v3/v4, unencrypted).
// Same logic as tools/pck.py, but finds the section itself, so it survives game updates.
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { join } from 'node:path';
import { GAME_DIR } from './paths.ts';

function read(fd: number, pos: number, len: number): Buffer {
  const b = Buffer.alloc(len);
  readSync(fd, b, 0, len, pos);
  return b;
}

/** Offset of the PE section named "pck", or of a trailing/standalone PCK. */
function findPck(fd: number): number {
  const dos = read(fd, 0, 0x40);
  const pe = dos.readUInt32LE(0x3c);
  const hdr = read(fd, pe, 24);
  const nsec = hdr.readUInt16LE(6);
  const optSize = hdr.readUInt16LE(20);
  const table = read(fd, pe + 24 + optSize, nsec * 40);
  for (let i = 0; i < nsec; i++) {
    const name = table
      .subarray(i * 40, i * 40 + 8)
      .toString('ascii')
      .replace(/\0+$/, '');
    if (name === 'pck') return table.readUInt32LE(i * 40 + 20); // PointerToRawData
  }
  const size = fstatSync(fd).size;
  const tail = read(fd, size - 12, 12);
  if (tail.subarray(8).toString('ascii') === 'GDPC') return size - 12 - Number(tail.readBigUInt64LE(0));
  throw new Error('no PCK found in the executable');
}

export interface PckEntry {
  path: string;
  offset: number;
  size: number;
}

export function listPck(exe = join(GAME_DIR, 'Melvor2.exe')): { fd: number; entries: PckEntry[]; godot: string } {
  const fd = openSync(exe, 'r');
  const start = findPck(fd);
  const h = read(fd, start, 4 + 16 + 12 + 8);
  if (h.subarray(0, 4).toString('ascii') !== 'GDPC') throw new Error('bad PCK header');
  const format = h.readUInt32LE(4);
  const godot = `${h.readUInt32LE(8)}.${h.readUInt32LE(12)}.${h.readUInt32LE(16)}`;
  const flags = h.readUInt32LE(20);
  let fileBase = Number(h.readBigUInt64LE(24));
  if (flags & 1) throw new Error('PCK directory is encrypted');
  if (flags & 2) fileBase += start;
  if (format < 3) throw new Error(`PCK format ${format} not supported`);
  const dirOffset = Number(h.readBigUInt64LE(32));
  let pos = start + dirOffset;
  const count = read(fd, pos, 4).readUInt32LE(0);
  pos += 4;
  const entries: PckEntry[] = [];
  for (let i = 0; i < count; i++) {
    const plen = read(fd, pos, 4).readUInt32LE(0);
    pos += 4;
    const path = read(fd, pos, plen).toString('utf8').replace(/\0+$/, '');
    pos += plen;
    const meta = read(fd, pos, 16 + 16 + 4);
    pos += 36;
    entries.push({ path, offset: fileBase + Number(meta.readBigUInt64LE(0)), size: Number(meta.readBigUInt64LE(8)) });
  }
  return { fd, entries, godot };
}

/** The game's data package (all items, recipes, enemies...). */
export function readGameData(exe?: string): any {
  const { fd, entries } = listPck(exe);
  try {
    const e = entries.find((x) => x.path.endsWith('Data/Packages/MelvorBase.json'));
    if (!e) throw new Error('MelvorBase.json not found in the PCK');
    return JSON.parse(read(fd, e.offset, e.size).toString('utf8').replace(/^﻿/, ''));
  } finally {
    closeSync(fd);
  }
}
