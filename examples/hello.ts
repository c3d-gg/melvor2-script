// Read-only: prints what your character is doing. Safe to run any time.
//   bun examples/hello.ts
import { run } from 'melvor2-script';

run(async (m) => {
  const { mode, saveLoaded } = m.state;
  if (!saveLoaded) {
    m.log(`The game is on the ${mode} screen. Load a save (or: bun run melvor2 load-save).`);
    return;
  }
  const doing = m.state.active?.map((a) => `${a.skill.split(':')[1]}: ${a.recipeName}`).join(', ') || 'nothing';
  m.log(`Hello from TypeScript! You're doing ${doing}.`);
  m.log(`Woodcutting ${m.skills.woodcutting.level}, Mining ${m.skills.mining.level}, ${m.gp} GP.`);
  const top = Object.entries(m.state.bank ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([id, n]) => `${n} ${id.split(':')[1]}`);
  m.log(`Biggest stacks: ${top.join(', ')}`);
});
