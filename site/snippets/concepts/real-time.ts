// Code for the Real time page (site/src/content/docs/concepts/real-time.mdx).
import { run, MiningRecipes, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  // #region start
  await m.skills.mining.start(MiningRecipes.Stone); // resolves with { started: true }
  // Asking again for what's already running changes nothing: { started: false, already: true }
  await m.skills.mining.start(MiningRecipes.Stone);
  // #endregion

  // #region switch
  await m.skills.mining.start(MiningRecipes.Stone);
  // A different action within a second of the last switch: start() waits the rest of that second first.
  await m.skills.woodcutting.start(WoodcuttingRecipes.NormalTree);
  // #endregion

  // #region stop
  await m.stop(); // whatever it was doing: a skill or a fight
  // #endregion
});
