#!/usr/bin/env bun
// melvor2 CLI:  bun run melvor2 <command>
//   status                    runtime + game info
//   state                     the current game state (JSON)
//   reload                    swap the in-game runtime for the freshly installed dll (no game restart)
//   saves                     saves on this machine
//   load-save [id]            from the main menu: load a save (latest by default)
//   recipes <skill>           what a skill can do, e.g. recipes Woodcutting
//   call <method> [json]      any RPC, e.g. call skill.start '{"skill":"Woodcutting","recipe":"NormalTree"}'
//   watch                     print state changes and events as they happen
import { Connection } from '../client/connection.ts';

const [cmd = 'status', ...args] = process.argv.slice(2);
const conn = await Connection.open().catch((e) => {
  console.error(String(e instanceof Error ? e.message : e));
  process.exit(1);
});

const print = (v: unknown) => console.log(JSON.stringify(v, null, 2));

try {
  switch (cmd) {
    case 'status':
      print(await conn.call('runtime.hello', { name: 'cli' }));
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
      console.error('the runtime did not come back; check runtime.log / bootstrap.log (bun run mod-status)');
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
      console.error(`unknown command '${cmd}'`);
      process.exitCode = 1;
  }
} catch (e) {
  const err = e as { code?: string; message?: string };
  console.error(err.code ? `${err.code}: ${err.message}` : String(e));
  process.exitCode = 1;
} finally {
  if (cmd !== 'watch') conn.close();
}
