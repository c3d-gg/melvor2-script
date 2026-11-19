// Lesson 3, challenge: stop at 100 logs, or as soon as Woodcutting reaches level 15.
import { run, Items, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  while (m.count(Items.NormalLog) < 100 && m.skills.woodcutting.level < 15) {
    await m.skills.woodcutting.act(WoodcuttingRecipes.NormalTree);
  }
  m.log(`Stopped with ${m.count(Items.NormalLog)} logs at level ${m.skills.woodcutting.level}.`);
});
