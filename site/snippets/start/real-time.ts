// Real time: start an action and it repeats on its own, like a click. Then wait for what you want.
import { run, Items, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  const target = m.count(Items.NormalLog) + 100;
  await m.skills.woodcutting.start(WoodcuttingRecipes.NormalTree);
  await m.waitFor(() => m.count(Items.NormalLog) >= target);
  m.log(`${target} normal logs!`);
});
