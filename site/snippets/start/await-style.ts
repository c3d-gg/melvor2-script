// Scripted Mode, await style: every act() resolves when you may act again, so a plain loop paces itself.
import { run, Items, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  while (m.count(Items.NormalLog) < 200) {
    await m.skills.woodcutting.act(WoodcuttingRecipes.NormalTree);
  }
});
