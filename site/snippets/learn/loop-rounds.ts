// Lesson 3: three rounds of "chop until there are 10 logs, then burn 10". A for loop counts the rounds.
import { run, FiremakingRecipes, Items, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  for (let round = 1; round <= 3; round++) {
    while (m.count(Items.NormalLog) < 10) {
      await m.skills.woodcutting.act(WoodcuttingRecipes.NormalTree);
    }
    await m.skills.firemaking.act(FiremakingRecipes.NormalLog, { count: 10 });
    m.log(`Round ${round} done`);
  }
});
