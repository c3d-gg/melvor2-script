// Code for the skills guide (site/src/content/docs/guides/skills.mdx).
// Each `// #region` is shown on the page by <Snippet region="...">. Never run as a whole.
import {
  run,
  CookingRecipes,
  FishingRecipes,
  Items,
  MiningRecipes,
  SmithingRecipes,
  WoodcuttingRecipes,
} from 'melvor2-script';

run(async (m) => {
  // #region recipes
  const trees = await m.skills.woodcutting.recipes(); // [{ id, name, unlocked }, ...]
  const open = trees.filter((t) => t.unlocked).map((t) => t.name);
  m.log(`You can cut: ${open.join(', ')}`);
  // #endregion

  // #region levels
  m.log(`Woodcutting ${m.skills.woodcutting.level}, ${m.skills.woodcutting.xpToNext} xp to the next level`);
  m.log(`${m.skills.woodcutting.xp} xp in total (${m.skills.woodcutting.id})`);
  if (m.skills.mining.active) m.log(`Mining ${m.skills.mining.current}`); // e.g. MelvorBase:Stone
  // #endregion

  // #region gather-real
  // 200 more stone. The game repeats the swing; the script only waits.
  const target = m.count(Items.Stone) + 200;
  await m.skills.mining.start(MiningRecipes.Stone);
  await m.waitFor(() => m.count(Items.Stone) >= target);
  // #endregion

  // #region gather-scripted
  // 200 more stone, one swing at a time. Each act resolves when the next swing is allowed.
  const goal = m.count(Items.Stone) + 200;
  while (m.count(Items.Stone) < goal) {
    await m.skills.mining.act(MiningRecipes.Stone);
  }
  // #endregion

  // #region fish
  // Shallow Pools (Fishing 1) catches Raw Shrimp, now and then junk.
  await m.skills.fishing.start(FishingRecipes.ShallowPools);
  // #endregion

  // #region craft-real
  // Cook every Raw Shrimp in the bank. Throws MISSING_ITEMS if there are none.
  await m.skills.cooking.start(CookingRecipes.Shrimp);
  await m.waitFor(() => m.count(Items.RawShrimp) === 0);
  // #endregion

  // #region craft-scripted
  const raw = m.count(Items.RawShrimp);
  if (raw > 0) {
    // allowStop: if something ends it early, resolve with what was done instead of throwing.
    const r = await m.skills.cooking.act(CookingRecipes.Shrimp, { count: raw, allowStop: true });
    m.log(`${r.actions} actions, ${r.items[Items.Shrimp] ?? 0} shrimp, +${r.xp} xp`);
  }
  // #endregion

  // #region steps
  // A Stone Sword takes 2 crafting steps: one act does one step.
  const sword = await m.skills.smithing.act(SmithingRecipes.StoneSword, { count: 2 });
  m.log(`Swords made: ${sword.items[Items.StoneSword] ?? 0}`);
  // #endregion

  // #region stop
  await m.stop();
  // #endregion
});
