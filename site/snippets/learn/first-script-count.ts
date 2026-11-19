// Lesson 2, challenge: how many logs do you have now?
import { run, Items, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  await m.skills.woodcutting.act(WoodcuttingRecipes.NormalTree, { count: 10 });
  m.log(`I have ${m.count(Items.NormalLog)} normal logs.`);
});
