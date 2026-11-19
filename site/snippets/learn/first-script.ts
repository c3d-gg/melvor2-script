// Lesson 2: your first script. Ten swings at a normal tree, then says what level you are.
import { run, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  m.log('Off to chop some trees!');
  await m.skills.woodcutting.act(WoodcuttingRecipes.NormalTree, { count: 10 });
  m.log(`Done! Woodcutting is level ${m.skills.woodcutting.level}.`);
});
