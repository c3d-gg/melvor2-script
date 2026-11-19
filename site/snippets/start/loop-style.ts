// Scripted Mode, loop style (like Adventure Land): look at the game on a timer, act when ready.
import { run, FiremakingRecipes, Items, WoodcuttingRecipes } from 'melvor2-script';

run((m) => {
  setInterval(() => {
    if (!m.ready) return; // still cooling down
    if (m.count(Items.NormalLog) >= 20) m.skills.firemaking.act(FiremakingRecipes.NormalLog);
    else m.skills.woodcutting.act(WoodcuttingRecipes.NormalTree);
  }, 50);
});
