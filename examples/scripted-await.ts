// Scripted Mode, await style: every act() resolves when you may act again.
// Mines 25 times, printing what each batch of 5 gave.
//   bun run melvor2 scripted on
//   bun examples/scripted-await.ts
import { run, MiningRecipes } from 'melvor2-script';

run(async (m) => {
  if (!m.scripted) return m.log('Scripted Mode is off for this save: bun run melvor2 scripted on');
  m.log(`Speed ${m.speed}: each swing waits its normal time ÷ ${m.speed}.`);
  for (let i = 0; i < 5; i++) {
    const r = await m.skills.mining.act(MiningRecipes.Stone, { count: 5 });
    m.log(`${r.actions} swings in ${r.durationMs} ms: +${r.xp} xp, items ${JSON.stringify(r.items)}`);
  }
});
