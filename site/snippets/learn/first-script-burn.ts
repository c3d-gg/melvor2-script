// Lesson 2, challenge: chop, then burn. A normal tree gives a log every 3 chops, so 15 chops make 5 logs.
import { run, FiremakingRecipes, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  await m.skills.woodcutting.act(WoodcuttingRecipes.NormalTree, { count: 15 });
  await m.skills.firemaking.act(FiremakingRecipes.NormalLog, { count: 5 });
  m.log(`Firemaking is level ${m.skills.firemaking.level}.`);
});
