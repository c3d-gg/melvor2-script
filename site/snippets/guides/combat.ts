// Code for the combat guide (site/src/content/docs/guides/combat.mdx).
// Each `// #region` is shown on the page by <Snippet region="...">. Never run as a whole.
import { run, AreaEnemies, CombatAreas, Enemies, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  // #region fight
  await m.combat.fight(CombatAreas.GolbinForest, Enemies.Golbin);
  m.log(`${m.combat.state}: ${m.combat.hp}/${m.combat.maxHp} hp`);
  // #endregion

  // #region area-enemies
  // Who can you fight in the Golbin Forest?
  const enemies = AreaEnemies[CombatAreas.GolbinForest] ?? [];
  m.log(enemies); // ['MelvorBase:Golbin', 'MelvorBase:GolbinScout', ...]
  // #endregion

  // #region stop
  await m.combat.stop();
  // #endregion

  // #region cooldown
  // Straight from woodcutting into a fight: fight() waits out the one-second rule by itself.
  await m.skills.woodcutting.start(WoodcuttingRecipes.NormalTree);
  await m.combat.fight(CombatAreas.GolbinForest, Enemies.Golbin); // ~1 s later
  // #endregion
});
