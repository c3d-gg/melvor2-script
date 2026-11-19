// Scripted Mode, loop style (like Adventure Land): look at the game every tick, act when ready.
// Cuts normal trees, burns the logs once there are 20. Runs until Ctrl+C.
//   bun run melvor2 scripted on     (once, for the loaded save)
//   bun examples/scripted-loop.ts
import { run, FiremakingRecipes, Items, WoodcuttingRecipes } from 'melvor2-script';

run((m) => {
  if (!m.scripted) {
    m.log('Scripted Mode is off for this save: bun run melvor2 scripted on');
    process.exit(1);
  }
  setInterval(() => {
    if (!m.ready) return; // still cooling down
    if (m.count(Items.NormalLog) >= 20) m.skills.firemaking.act(FiremakingRecipes.NormalLog);
    else m.skills.woodcutting.act(WoodcuttingRecipes.NormalTree);
  }, 50);
});
