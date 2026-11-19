// Code for the Scripted Mode page (site/src/content/docs/concepts/scripted-mode.mdx).
import {
  run,
  FiremakingRecipes,
  Items,
  MelvorError,
  MiningRecipes,
  WoodcuttingRecipes,
  type ActionResult,
} from 'melvor2-script';

run(async (m) => {
  // #region turn-on
  if (!m.scripted) await m.setScripted({ on: true }); // this save only
  await m.setScripted({ speed: 50 }); // every Scripted save
  m.log(`Scripted Mode, speed ${m.speed}`);
  // #endregion

  // #region one
  const r = await m.skills.mining.act(MiningRecipes.Stone); // one swing, at once
  m.log(`+${r.xp} xp, ${r.items[Items.Stone] ?? 0} stone`); // stone isn't guaranteed on every swing
  // #endregion

  // #region ready
  if (!m.ready) m.log(`Cooling down: ${Math.ceil(m.cooldown)} ms left`);
  await m.whenReady(); // or just wait for it
  // #endregion

  // #region count
  // 30 swings, spaced by the cooldown, in one call. A normal tree gives a log every 3 hits.
  const swings = await m.skills.woodcutting.act(WoodcuttingRecipes.NormalTree, { count: 30 });
  m.log(`${swings.actions} swings in ${swings.durationMs} ms: ${swings.items[Items.NormalLog] ?? 0} logs`);
  // #endregion

  // #region stopped
  try {
    await m.skills.firemaking.act(FiremakingRecipes.NormalLog, { count: 100 });
  } catch (e) {
    if (!(e instanceof MelvorError)) throw e;
    const partial = e.data as ActionResult | undefined; // what happened before it stopped
    m.log(`${e.code} after ${partial?.actions ?? 0} burns: ${e.message}`);
  }

  // Or take the partial result instead of an error:
  const burned = await m.skills.firemaking.act(FiremakingRecipes.NormalLog, { count: 100, allowStop: true });
  if (!burned.completed) m.log(`Burned ${burned.actions} logs, then: ${burned.stopped}`);
  // #endregion
});
