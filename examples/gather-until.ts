// Cut normal trees until you have 10 more logs, then go back to what you were doing.
//   bun examples/gather-until.ts
import { run, Items, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  const before = m.state.active?.[0]; // remember the current action
  const target = m.count(Items.NormalLog) + 10;

  await m.skills.woodcutting.start(WoodcuttingRecipes.NormalTree);
  m.log(`Cutting until ${target} normal logs...`);
  await m.waitFor(() => m.count(Items.NormalLog) >= target);
  m.log(`Done: ${m.count(Items.NormalLog)} logs.`);

  if (before?.recipe) {
    const skill = Object.values(m.skills).find((s) => s.id === before.skill);
    await skill?.start(before.recipe);
    m.log(`Back to ${before.recipeName}.`);
  }
});
