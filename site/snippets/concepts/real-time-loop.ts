// Loop style in real time: cut until there are 50 logs, burn them all, repeat. Runs until Ctrl+C.
import { run, FiremakingRecipes, Items, WoodcuttingRecipes } from 'melvor2-script';

run((m) => {
  let burning = false;
  setInterval(() => {
    const logs = m.count(Items.NormalLog);
    if (logs >= 50) burning = true;
    if (logs === 0) burning = false;
    // Only call start() when it would change something: the game allows one switch per second.
    if (burning && !m.skills.firemaking.active) m.skills.firemaking.start(FiremakingRecipes.NormalLog);
    if (!burning && !m.skills.woodcutting.active) m.skills.woodcutting.start(WoodcuttingRecipes.NormalTree);
  }, 1000);
});
