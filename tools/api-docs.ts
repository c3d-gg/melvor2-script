/**
 *   bun run docs            write docs/API.md from the client's types and doc comments
 *   bun run docs --check    fail if docs/API.md is out of date (`bun run release` runs this)
 *
 * The same reference as the docs site, on one page. It ships in the package, so it's in
 * node_modules/melvor2-script/docs/API.md for anyone (or any tool) reading offline.
 * The reference is generated, so it can't drift from the code: to improve a description,
 * edit the doc comment in src/ (VS Code shows the same text on hover) and rerun.
 */
import ts from 'typescript';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  ROOT,
  RESULT_TYPES,
  STATE_TYPES,
  buildPages,
  cliCommands,
  cls,
  doc,
  errorCodes,
  events,
  fields,
  flat,
  formatted,
  iface,
  md,
  members,
  readIds,
  rpcs,
  source,
  type ApiMember,
} from './api-source.ts';

const OUT = join(ROOT, 'docs', 'API.md');
const SITE = 'https://c3d-gg.github.io/melvor2-script';

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n+/g, ' ');
/** Links to the reference pages this file has as sections become anchors; other site links become absolute URLs. */
const links = (s: string) =>
  s
    .replace('have their own pages', 'have their own sections')
    .replace(/\]\(\/reference\/(skills|combat)\/\)/g, '](#m$1)')
    .replace(/\]\((\/[^)]*)\)/g, `](${SITE}$1)`);

const PACE: Record<NonNullable<ApiMember['pace']>, string> = {
  cooldown: ' _(Scripted Mode cooldown)_',
  switch: ' _(one switch per second)_',
  free: '',
};

function memberList(list: ApiMember[], prefix: string): string {
  return list
    .map((m) => {
      const body = md(links(m.doc), '  ');
      return `- **\`${prefix}${m.sig}\`**${m.pace ? PACE[m.pace] : ''}${body ? `\n${body}` : ''}`;
    })
    .join('\n');
}

function typeTable(name: string, node: ts.InterfaceDeclaration | ts.TypeLiteralNode): string {
  const rows = fields(node).map((f) => `| \`${f.name}\` | \`${cell(f.type)}\` | ${cell(f.doc)} |`);
  const about = ts.isInterfaceDeclaration(node) ? doc(node) : '';
  return [`### \`${name}\``, about && md(about), '| Field | Type | |\n| --- | --- | --- |\n' + rows.join('\n')]
    .filter(Boolean)
    .join('\n\n');
}

function build(): string {
  const protocol = source('protocol');
  const pages = buildPages();
  const out: string[] = [];

  out.push(`# API reference

Everything a script can do. \`m\` is the object your \`run\` callback gets. The docs site has the same reference with
guides and a course: ${SITE}/

- **Reads are synchronous.** \`m.state\` mirrors the game, pushed whenever it changes (up to 4 times a second).
  \`m.count(...)\`, \`m.gp\` and \`m.skills.woodcutting.level\` read from it.
- **Real time** (the default): \`start(recipe)\` repeats an action like a click. Changing what the character does is
  limited to one switch per second; \`start()\` waits that out itself.
- **Scripted Mode** (\`bunx melvor2 scripted on\`, per save): \`act(recipe)\` happens at once, then a cooldown of the
  action's time ÷ speed. Calling it while \`!m.ready\` rejects at once with \`COOLDOWN\` or \`BUSY\`.
- **Ids are typed.** \`Items.NormalLog\`, \`WoodcuttingRecipes.NormalTree\`, \`Enemies.Golbin\`: a typo fails at compile
  time. See [Ids](#ids).

Generated from the source by \`bun run docs\`. The descriptions are the doc comments VS Code shows on hover.`);

  for (const p of pages) {
    out.push(`## ${p.title}`, md(links(p.intro)));
    const prefix = p.slug === 'm' ? 'm.' : p.slug === 'skills' ? 'm.skills.<name>.' : `${p.title}.`;
    for (const g of p.groups) {
      if (g.title) out.push(`### ${g.title}`);
      if (g.intro) out.push(md(links(g.intro)));
      out.push(memberList(g.members, g.members[0]?.id === 'run' ? '' : prefix));
    }
    if (p.after) out.push(p.after.replace(/^## /m, '### '));
  }

  out.push('## Results', ...RESULT_TYPES.map((n) => typeTable(n, iface(protocol, n))));
  out.push(
    '## m.state',
    'The live mirror behind every synchronous read. `m.onState(fn)` and `m.waitFor(predicate)` watch it.',
    ...STATE_TYPES.map((n) => typeTable(n, iface(protocol, n))),
  );
  out.push(
    '## Events',
    "Subscribe with `m.on(type, handler)` (returns an unsubscribe function); `'*'` gets every event.",
    '| Type | Fields | |\n| --- | --- | --- |\n' +
      events()
        .map((e) => `| \`${e.type}\` | \`${cell(e.fields)}\` | ${cell(e.doc)} |`)
        .join('\n'),
  );

  const err = cls(source('connection'), 'MelvorError');
  const errProps = members(err).filter((m) => m.kind === 'property');
  out.push(
    '## Errors',
    `Failed calls reject with a \`MelvorError\`. ${flat(doc(err))} Besides \`message\`, it has ${errProps.map((p) => `\`${p.sig}\``).join(' and ')}.`,
    '| Code | |\n| --- | --- |\n' +
      errorCodes()
        .map((c) => `| \`${c.code}\` | ${cell(c.doc)} |`)
        .join('\n'),
  );

  out.push(
    '## Protocol',
    "Every call the runtime understands. `m.conn.call(method, params)` sends any of them, typed, including ones `m` doesn't wrap.",
    '| Method | Params | Result | |\n| --- | --- | --- | --- |\n' +
      rpcs()
        .map(
          (r) =>
            `| \`${r.method}\` | ${r.params ? `\`${cell(r.params)}\`` : ''} | \`${cell(r.result)}\` | ${cell(r.doc)} |`,
        )
        .join('\n'),
  );

  const cli = cliCommands();
  if (cli.length)
    out.push(
      '## CLI',
      '`bunx melvor2 <command>` in a scripts folder, `bun run melvor2 <command>` in a clone of the repo.',
      ...cli.map(
        (s) =>
          (s.title ? `**${s.title}**\n\n` : '') +
          '| Command | |\n| --- | --- |\n' +
          s.commands.map((c) => `| \`${cell(c.usage)}\` | ${cell(c.about)} |`).join('\n'),
      ),
    );

  const { maps, skipped } = readIds();
  out.push(
    '## Ids',
    "Const maps of every id in the game, from `import { Items, WoodcuttingRecipes, ... } from 'melvor2-script'`. Each has a matching type (`ItemId`, ...). They're generated from the game's data; in a clone of the repo, `bun run gen:ids` regenerates them from your installed game. Search them by name on the docs site: " +
      `${SITE}/reference/ids/`,
    '| Map | Ids | Example | |\n| --- | --- | --- | --- |\n' +
      maps.map((m) => `| \`${m.name}\` | ${m.count} | \`${m.example}\` | ${cell(m.about)} |`).join('\n'),
    skipped.includes('AreaEnemies')
      ? '`AreaEnemies` maps each combat area to the enemies you can fight there: `AreaEnemies[CombatAreas.GolbinForest]`.'
      : '',
  );

  return (
    out
      .filter(Boolean)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n') + '\n'
  );
}

mkdirSync(dirname(OUT), { recursive: true });
const page = formatted(build(), '.md', 'docs');
if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== page) {
    console.error('✖ docs/API.md is out of date: run `bun run docs`.');
    process.exit(1);
  }
  console.log('docs/API.md is up to date.');
} else {
  writeFileSync(OUT, page);
  console.log(`wrote docs/API.md (${page.split('\n').length} lines)`);
}
