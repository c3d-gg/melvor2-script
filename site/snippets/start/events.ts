// Reading the game and reacting to it, for the How it works page.
import { run, Items } from 'melvor2-script';

run(async (m) => {
  // #region read
  m.count(Items.NormalLog); // how many are in the bank right now
  m.skills.woodcutting.level;
  m.combat.hp;
  m.state.active; // what the character is doing: [{ skill, recipe, recipeName }]
  // #endregion

  // #region load-save
  // On the main menu? Load the most recent save and wait until it's ready.
  if (!m.state.saveLoaded) {
    await m.loadSave();
    await m.waitFor((s) => s.saveLoaded);
  }
  // #endregion

  // #region wait-for
  await m.waitFor(() => m.skills.woodcutting.level >= 15);
  m.log('Woodcutting 15!');
  // #endregion

  // #region on
  const off = m.on('levelUp', (e) => m.log(`${e.skill} is level ${e.level} now (was ${e.from})`));
  m.on('actionChanged', (e) =>
    m.log(`Now doing: ${e.active.map((a) => a.recipeName ?? a.skill).join(', ') || 'nothing'}`),
  );
  // later: off() stops listening
  // #endregion
  off();

  // #region on-state
  // Every new state, at most four times a second.
  m.onState((s) => {
    if (s.bankSlots && s.bankSlots.used >= s.bankSlots.max) m.log('The bank is full!');
  });
  // #endregion

  // #region conn
  // A call m doesn't wrap: the runtime and game versions.
  const info = await m.conn.call('runtime.info');
  m.log(`Melvor Idle 2 ${info.gameVersion}, mod ${info.runtimeVersion}`);
  // #endregion
});
