// Handling a refused call, for the How it works page.
import { run, MelvorError, WoodcuttingRecipes } from 'melvor2-script';

run(async (m) => {
  // #region errors
  try {
    await m.skills.woodcutting.start(WoodcuttingRecipes.YewTree);
  } catch (e) {
    if (!(e instanceof MelvorError)) throw e; // a bug in the script: let it stop
    if (e.code === 'LOCKED')
      m.log(`Not yet: ${e.message}`); // "Yew Tree is locked (requirements not met)": it needs level 60
    else if (e.code === 'MISSING_ITEMS') m.log(`Short of something: ${e.message}`);
    else throw e;
  }
  // #endregion
});
