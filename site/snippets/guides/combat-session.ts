// Ten minutes against Golbins: eat below half HP, log level-ups, then leave.
import { run, CombatAreas, Enemies } from 'melvor2-script';

run(async (m) => {
  const stopLogging = m.on('levelUp', (e) => m.log(`${e.skill} is level ${e.level}`));

  let eating = false;
  const stopEating = m.onState(() => {
    if (eating || m.combat.state === 'Idle' || m.combat.hp > m.combat.maxHp / 2) return;
    eating = true; // eat once, not on every update while the first bite is on its way
    m.combat
      .eat()
      .then((r) => r.healed === 0 && m.log('Nothing to eat! Pick a food in the game.'))
      .finally(() => (eating = false));
  });

  await m.combat.fight(CombatAreas.GolbinForest, Enemies.Golbin);
  await Bun.sleep(10 * 60_000);
  await m.combat.stop();
  // Listeners keep a script running: remove them, and it ends when this function returns.
  stopLogging();
  stopEating();
});
