// Lesson 3: a variable that changes. Count the chops as you go.
import { run, Items, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  let chops = 0;

  while (m.count(Items.NormalLog) < 100) {
    await m.skills.woodcutting.act(WoodcuttingRecipes.NormalTree);
    chops = chops + 1;
  }

  m.log(`That took ${chops} chops.`);
});
