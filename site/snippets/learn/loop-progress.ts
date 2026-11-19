// Lesson 3, challenge: report progress every 10 chops. `chops % 10` is the remainder
// after dividing by 10, so it's 0 on chop 10, 20, 30...
import { run, Items, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  let chops = 0;
  while (m.count(Items.NormalLog) < 100) {
    await m.skills.woodcutting.act(WoodcuttingRecipes.NormalTree);
    chops++;
    if (chops % 10 === 0) m.log(`${chops} chops so far`);
  }
});
