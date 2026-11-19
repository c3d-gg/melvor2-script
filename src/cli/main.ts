#!/usr/bin/env bun
// melvor2 CLI: `bunx melvor2 <command>` in a project that installed melvor2-script,
// `bun run melvor2 <command>` in a clone of the repo.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Connection } from '../client/connection.ts';
import { init } from './init.ts';
import { installRelease, status as modStatus, uninstall } from './modfiles.ts';

const HELP = `melvor2 <command>

Setup (no game needed)
  init                      set up this folder for scripts (scripts/hello.ts, tsconfig, VS Code F5)
  install                   download this version's mod files from GitHub and install them into Melvor Idle 2
  uninstall                 remove the mod (override.cfg + the mod folder)
  mod-status                what's installed, and the end of each log

Game (needs Melvor Idle 2 running with the mod)
  status                    runtime + game info
  state                     the current game state (JSON)
  saves                     saves on this machine
  load-save [id]            from the main menu: load a save (latest by default)
  recipes <Skill>           what a skill can do, e.g. recipes Woodcutting
  scripted [on|off]         Scripted Mode for the loaded save (no argument: show status)
  speed [n]                 Scripted Mode speed, 1..1000 (no argument: show it)
  act <Skill> <recipe> [n]  Scripted Mode: n instant actions, e.g. act Mining Stone 10
  call <method> [json]      any RPC, e.g. call skill.start '{"skill":"Woodcutting","recipe":"NormalTree"}'
  watch                     print events as they happen
  reload                    swap the in-game runtime for the freshly installed dll (dev loop, no restart)`;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const VERSION = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
const [cmd = 'help', ...args] = process.argv.slice(2);
const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

// ---- commands that don't talk to the game -----------------------------------------------------
switch (cmd) {
  case 'help':
  case '--help':
  case '-h':
    console.log(HELP);
    process.exit(0);
  case 'init':
    init(process.cwd(), ROOT);
    process.exit(0);
  case 'install':
    try {
      await installRelease(args[0]?.replace(/^v/, '') ?? VERSION);
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    }
    process.exit(0);
  case 'uninstall':
    uninstall();
    process.exit(0);
  case 'mod-status':
    modStatus();
    process.exit(0);
}

// ---- commands that do -------------------------------------------------------------------------
const conn = await Connection.open().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});

try {
  switch (cmd) {
    case 'status':
      print({ client: VERSION, ...(await conn.call('runtime.hello', { name: 'cli' })) });
      break;
    case 'state':
      print(await conn.call('state.get'));
      break;
    case 'reload': {
      const before = await conn.call('runtime.info');
      await conn.call('runtime.reload');
      conn.close();
      // The old server goes away; connect to the new one and confirm.
      for (let i = 0; i < 20; i++) {
        await Bun.sleep(250);
        const fresh = await Connection.open().catch(() => null);
        if (!fresh) continue;
        const info = await fresh.call('runtime.info').catch(() => null);
        fresh.close();
        if (info && info.generation > before.generation) {
          console.log(`reloaded: runtime #${before.generation} -> #${info.generation}`);
          process.exit(0);
        }
      }
      console.error('the runtime did not come back; check the logs (melvor2 mod-status)');
      process.exit(1);
    }
    case 'saves':
      print(await conn.call('game.saves'));
      break;
    case 'load-save':
      print(await conn.call('game.loadSave', args[0] ? { id: args[0] } : {}));
      break;
    case 'recipes':
      print(await conn.call('skill.recipes', { skill: args[0] ?? 'Woodcutting' }));
      break;
    case 'scripted': {
      const on = args[0] === 'on' ? true : args[0] === 'off' ? false : undefined;
      print(on === undefined ? await conn.call('scripted.status') : await conn.call('scripted.set', { on }));
      break;
    }
    case 'speed':
      if (!args[0]) print((await conn.call('scripted.status')).speed);
      else print(await conn.call('scripted.set', { speed: Number(args[0]) }));
      break;
    case 'act':
      print(await conn.call('skill.act', { skill: args[0]!, recipe: args[1]!, count: args[2] ? Number(args[2]) : 1 }));
      break;
    case 'call':
      print(await conn.callRaw(args[0]!, args[1] ? JSON.parse(args[1]) : undefined));
      break;
    case 'watch': {
      let last = '';
      conn.onNotification((method, params) => {
        if (method === 'event') console.log(new Date().toLocaleTimeString(), 'event', JSON.stringify(params));
        else if (method === 'state') {
          const s = params as { active?: unknown; mode: string };
          const line = `${s.mode} active=${JSON.stringify(s.active ?? [])}`;
          if (line !== last) console.log(new Date().toLocaleTimeString(), line);
          last = line;
        }
      });
      await conn.call('runtime.hello', { name: 'watch' });
      console.log('watching (Ctrl+C to stop)');
      await new Promise<never>(() => {});
      break;
    }
    default:
      console.error(`unknown command '${cmd}'\n\n${HELP}`);
      process.exitCode = 1;
  }
} catch (e) {
  const err = e as { code?: string; message?: string };
  console.error(err.code ? `${err.code}: ${err.message}` : String(e));
  process.exitCode = 1;
} finally {
  if (cmd !== 'watch') conn.close();
}
