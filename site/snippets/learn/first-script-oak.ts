// Lesson 2, challenge: oak trees. Below Woodcutting level 10 the game refuses, and the script
// stops with an error that says why: "LOCKED: Oak Tree is locked (requirements not met)".
import { run, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  await m.skills.woodcutting.act(WoodcuttingRecipes.OakTree, { count: 10 });
  m.log(`Done! Woodcutting is level ${m.skills.woodcutting.level}.`);
});
