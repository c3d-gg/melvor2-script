// Lesson 3: keep chopping until there are 100 logs in the bank.
import { run, Items, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  const target = 100;

  while (m.count(Items.NormalLog) < target) {
    await m.skills.woodcutting.act(WoodcuttingRecipes.NormalTree);
  }

  m.log(`I have ${m.count(Items.NormalLog)} logs!`);
});
