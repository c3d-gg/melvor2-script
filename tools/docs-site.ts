/**
 *   bun run docs:site           generate the docs site's reference pages, id list and changelog page
 *   bun run docs:site --check   fail if the docs are incomplete (CI runs this):
 *                                 - a public call or property without a doc comment
 *                                 - a call that no guide, lesson or concept page shows (see site/coverage.json)
 *                                 - an out-of-date entry in site/coverage.json
 *   bun run docs:site --todo    rewrite the "todo" list in site/coverage.json to what's uncovered now
 *
 * Generated files (gitignored, don't edit): site/src/content/docs/reference/, site/src/content/docs/changelog.md
 * and site/public/ids.json. To change what the reference says, edit the doc comments in src/client/ and
 * src/shared/protocol.ts. How the site is organised: site/CONTRIBUTING.md.
 */
import ts from 'typescript';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
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
  fn,
  formatted,
  iface,
  md,
  members,
  protocolConstants,
  readIds,
  rpcs,
  source,
  type ApiMember,
  type IdMap,
  type RefPage,
} from './api-source.ts';

const SITE = join(ROOT, 'site');
const DOCS = join(SITE, 'src/content/docs');
const REF = join(DOCS, 'reference');
const CHECK = process.argv.includes('--check');
const TODO = process.argv.includes('--todo');

// ---------------------------------------------------------------------------
// writing MDX
// ---------------------------------------------------------------------------

/** Escape the characters MDX treats as code (`{ }`) or tags (`< >`), outside code spans. */
function prose(s: string): string {
  return s
    .split(/(`[^`]*`)/g)
    .map((part, i) => (i % 2 ? part : part.replace(/[{}<>]/g, (c) => `\\${c}`)))
    .join('');
}

/** A doc comment as MDX: indented lines become ```ts blocks, the rest is escaped prose. */
function mdx(text: string): string {
  let fence = false;
  return md(text)
    .split('\n')
    .map((line) => {
      if (line.startsWith('```')) {
        fence = !fence;
        return line;
      }
      return fence ? line : prose(line);
    })
    .join('\n');
}

const cell = (s: string) => prose(s.replace(/\|/g, '\\|').replace(/\n+/g, ' '));
const code = (s: string) => `\`${s.replace(/\|/g, '\\|')}\``;

interface DocPage {
  title: string;
  href: string;
  section: string;
  text: string;
}

/** Hand-written pages (not the reference), with the files they pull in through <Snippet file="...">. */
function docPages(): DocPage[] {
  const out: DocPage[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, e.name);
      if (e.isDirectory()) {
        if (file !== REF) walk(file);
        continue;
      }
      if (!/\.mdx?$/.test(e.name) || file === join(DOCS, 'changelog.md')) continue;
      const raw = readFileSync(file, 'utf8');
      const rel = relative(DOCS, file)
        .replace(/\\/g, '/')
        .replace(/\.mdx?$/, '');
      const href = `/${rel.replace(/(^|\/)index$/, '')}/`.replace(/\/+/g, '/');
      const title = raw.match(/^title:\s*['"]?(.+?)['"]?\s*$/m)?.[1] ?? rel;
      const included = [...raw.matchAll(/<Snippet[^>]*?\bfile="([^"]+)"/g)].map((m) => {
        const path = join(ROOT, m[1]!);
        if (!existsSync(path)) throw new Error(`${relative(ROOT, file)}: <Snippet file="${m[1]}"> doesn't exist`);
        return readFileSync(path, 'utf8');
      });
      out.push({ title, href, section: rel.split('/')[0]!, text: [raw, ...included].join('\n') });
    }
  };
  walk(DOCS);
  return out;
}

const SECTION_LABEL: Record<string, string> = { learn: 'Lesson', guides: 'Guide', concepts: '', start: '' };

function usedIn(m: ApiMember, pages: DocPage[]): DocPage[] {
  return pages.filter((p) => m.usage.test(p.text) && p.href !== '/');
}

function usedLinks(m: ApiMember, pages: DocPage[]): string {
  return usedIn(m, pages)
    .map((p) => `[${prose(SECTION_LABEL[p.section] ? `${SECTION_LABEL[p.section]}: ${p.title}` : p.title)}](${p.href})`)
    .join(', ');
}

/** Properties as one compact table: name, type, description, and where guides use it. */
function propertyTable(props: ApiMember[], pages: DocPage[]): string {
  const rows = props.map((m) => {
    const type = m.sig.slice(m.name.length + 2);
    const used = usedLinks(m, pages);
    const about = cell(flat(m.doc)) + (used ? ` <span class="api-used">Used in ${used}.</span>` : '');
    return `| \`${m.name}\` | ${code(type)} | ${about} |`;
  });
  return '| Property | Type | |\n| --- | --- | --- |\n' + rows.join('\n');
}

const BADGE: Record<NonNullable<ApiMember['pace']>, string> = {
  cooldown: '<Badge text="Scripted Mode cooldown" variant="caution" />',
  switch: '<Badge text="One switch per second" variant="note" />',
  free: '<Badge text="No cooldown" variant="success" />',
};

function memberMdx(m: ApiMember, pages: DocPage[]): string {
  const heading = m.kind === 'method' ? `${m.name}()` : m.name;
  const meta: string[] = [];
  if (m.pace) meta.push(BADGE[m.pace]);
  const used = usedLinks(m, pages);
  if (used) meta.push(`<span class="api-used">Used in ${used}</span>`);
  return [
    `### \`${heading}\``,
    meta.length ? `<div class="api-meta">\n\n${meta.join(' ')}\n\n</div>` : '',
    '```ts\n' + m.sig + '\n```',
    mdx(m.doc),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function frontmatter(title: string, description: string, order: number, from = 'the doc comments in src/'): string {
  const q = (s: string) => JSON.stringify(s);
  return `---\ntitle: ${q(title)}\ndescription: ${q(description)}\nsidebar:\n  order: ${order}\n---\n\n{/* Generated by tools/docs-site.ts from ${from}. Edit those, not this file. */}\n`;
}

function pageMdx(p: RefPage, pages: DocPage[]): string {
  const parts = [
    frontmatter(p.title, p.description, p.order),
    "import { Badge } from '@astrojs/starlight/components';",
  ];
  if (p.intro) parts.push(mdx(p.intro));
  for (const g of p.groups) {
    if (g.title) parts.push(`## ${g.title}`);
    if (g.intro) parts.push(mdx(g.intro));
    const props = g.members.filter((m) => m.kind === 'property');
    const methods = g.members.filter((m) => m.kind === 'method');
    if (props.length) {
      if (!g.title) parts.push('## Properties');
      parts.push(
        '<p class="api-note">Synchronous: they read the live state the game pushes to your script.</p>',
        propertyTable(props, pages),
      );
    }
    if (props.length && methods.length && !g.title) parts.push('## Methods');
    parts.push(...methods.map((m) => memberMdx(m, pages)));
  }
  if (p.after) parts.push(p.after);
  return parts.join('\n\n') + '\n';
}

function typeTable(name: string, node: ts.InterfaceDeclaration | ts.TypeLiteralNode, intro = ''): string {
  const rows = fields(node).map((f) => `| \`${f.name}\` | ${code(f.type)} | ${cell(f.doc)} |`);
  const about = intro || (ts.isInterfaceDeclaration(node) ? doc(node) : '');
  return [`### \`${name}\``, about && mdx(about), '| Field | Type | |\n| --- | --- | --- |\n' + rows.join('\n')]
    .filter(Boolean)
    .join('\n\n');
}

function typesPage(): string {
  const protocol = source('protocol');
  return [
    frontmatter('Results', 'What calls resolve with: action results, Scripted Mode status, recipes, saves.', 21),
    "What the calls on [`m`](/reference/m/), [`m.skills`](/reference/skills/) and [`m.combat`](/reference/combat/) resolve with. They are exported as types: `import type { ActionResult } from 'melvor2-script'`.",
    ...RESULT_TYPES.map((n) => typeTable(n, iface(protocol, n))),
  ].join('\n\n');
}

function statePage(): string {
  const protocol = source('protocol');
  return [
    frontmatter('m.state', 'The live mirror of the game behind every synchronous read.', 20),
    'The live mirror behind every synchronous read. The game pushes it whenever something changes, at most four times a second, so right after an action it can be a moment behind. Most scripts use `m.count()`, `m.gp`, `m.skills.<name>.level` and `m.combat.hp` instead of reading it directly; `m.onState(fn)` and `m.waitFor(predicate)` watch it.',
    ...STATE_TYPES.map((n) => typeTable(n, iface(protocol, n))),
  ].join('\n\n');
}

function eventsPage(): string {
  const rows = events().map((e) => `| \`${e.type}\` | ${code(e.fields)} | ${cell(e.doc)} |`);
  return [
    frontmatter('Events', 'Things the game tells your script about as they happen.', 22),
    "Subscribe with `m.on(type, handler)`, which returns a function that unsubscribes. `m.on('*', handler)` gets every event. The runtime works them out from changes in the state, so they arrive with the state update that shows them (at most four times a second).",
    '| Type | Fields | |\n| --- | --- | --- |\n' + rows.join('\n'),
  ].join('\n\n');
}

function errorsPage(): string {
  const connection = source('connection');
  const err = cls(connection, 'MelvorError');
  const props = members(err).filter((m) => m.kind === 'property');
  return [
    frontmatter('Errors', 'Why a call failed: the error codes, and the MelvorError class.', 23),
    'A call the game refuses rejects with a `MelvorError`. Its `code` says why, `message` says it in words, and `data` carries details for some codes. [How it works](/concepts/how-it-works/#when-a-call-fails) shows how to handle them.',
    '## Codes',
    '| Code | |\n| --- | --- |\n' +
      errorCodes()
        .map((c) => `| \`${c.code}\` | ${cell(c.doc)} |`)
        .join('\n'),
    "`m.waitFor(pred, timeoutMs)` rejects with a plain `Error` ('waitFor timed out'), not a `MelvorError`.",
    '## `MelvorError`',
    mdx(flat(doc(err))),
    props.length ? `Has ${props.map((p) => `\`${p.sig}\``).join(', ')}.` : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

function protocolPage(): string {
  const connection = source('connection');
  const conn = cls(connection, 'Connection');
  const consts = protocolConstants();
  const rows = rpcs().map(
    (r) => `| \`${r.method}\` | ${r.params ? code(r.params) : ''} | ${code(r.result)} | ${cell(r.doc)} |`,
  );
  const fnRow = (name: string) => {
    const f = fn(connection, name);
    const sig = `${name}(${f.parameters.map((p) => flat(p.getText())).join(', ')})${f.type ? `: ${flat(f.type.getText())}` : ''}`;
    return `### \`${name}()\`\n\n\`\`\`ts\n${sig}\n\`\`\`\n\n${mdx(doc(f))}`;
  };
  const connMembers = members(conn);
  return [
    frontmatter('Protocol', 'The JSON-RPC calls the game understands, and the low-level Connection.', 24),
    `Scripts talk to the game over a WebSocket on \`ws://127.0.0.1:${consts.find((c) => c.name === 'DEFAULT_PORT')?.value ?? '7338'}/ws?token=…\`, with JSON-RPC-style messages (protocol version ${consts.find((c) => c.name === 'PROTOCOL_VERSION')?.value ?? '?'}). \`run()\` and \`m\` wrap all of it; this page is for tools and for calls \`m\` doesn't wrap yet, which \`m.conn.call(method, params)\` can send.`,
    '```text\nclient → game   { id, method, params }            request\ngame → client   { id, result } | { id, error }    response (error: { code, message, data? })\ngame → client   { method, params }                notification: "state" (GameState) or "event" (GameEvent)\n```',
    "The token comes from `~/.melvor2-scripting/config.json`, which the game writes on its first start with the mod. The server only listens on 127.0.0.1 and refuses any request with an `Origin` header, so web pages can't reach it.",
    '## Calls',
    '| Method | Params | Result | |\n| --- | --- | --- | --- |\n' + rows.join('\n'),
    '## `Connection`',
    mdx(doc(conn)),
    connMembers.filter((m) => m.kind === 'property').length
      ? propertyTable(
          connMembers.filter((m) => m.kind === 'property').map((m) => ({ ...m, id: m.name, usage: /$^/ })),
          [],
        )
      : '',
    ...connMembers
      .filter((m) => m.kind === 'method')
      .map((m) => memberMdx({ ...m, pace: undefined, id: m.name, usage: /$^/ }, [])),
    '## Configuration',
    fnRow('readConfig'),
    fnRow('configPath'),
    typeTable('ConnectionConfig', iface(connection, 'ConnectionConfig')),
  ]
    .filter(Boolean)
    .join('\n\n');
}

function cliPage(): string {
  const sections = cliCommands();
  const table = (cmds: { usage: string; about: string }[]) =>
    '| Command | |\n| --- | --- |\n' +
    cmds.map((c) => `| \`${c.usage.replace(/\|/g, '\\|')}\` | ${cell(c.about)} |`).join('\n');
  const body = sections.length
    ? sections.flatMap((s) => [s.title ? `## ${prose(s.title)}` : '', table(s.commands)]).filter(Boolean)
    : [
        'The command list is in [`src/cli/main.ts`](https://github.com/c3d-gg/melvor2-script/blob/main/src/cli/main.ts).',
      ];
  return [
    frontmatter(
      'CLI',
      'The melvor2 command: install the mod, check on the game, Scripted Mode, raw calls.',
      25,
      'the help text in src/cli/main.ts',
    ),
    'In a scripts folder that installed the package from GitHub, run it as `bunx melvor2 <command>`. In a clone of the repo, use `bun run melvor2 <command>`. With no command (or `help`), it prints this list.',
    ...body,
  ].join('\n\n');
}

function idsPage(maps: IdMap[], skipped: string[]): string {
  const rows = maps.map((m) => `| \`${m.name}\` | ${m.count} | \`${m.example}\` | ${cell(m.about)} |`);
  return [
    frontmatter(
      'Ids',
      'Find the typed id for any item, recipe, enemy, area or skill.',
      30,
      'src/shared/ids.generated.ts',
    ),
    "import IdSearch from '../../../components/IdSearch.astro';",
    "Every item, recipe, enemy, combat area and skill has an id. Import the map (`import { Items, WoodcuttingRecipes } from 'melvor2-script'`) and pick from it: `Items.NormalLog`. VS Code completes them as you type and shows the in-game name on hover, and a typo fails before the script runs.",
    'Search by name. Click a result to copy it.',
    '<IdSearch />',
    '## Every id map',
    "Each map has a matching type for function parameters (`Items` → `ItemId`). They're generated from the game's own data (`MelvorBase.json`), so they match the game version the package was built for. In a clone of the repo, `bun run gen:ids` regenerates them from your installed game.",
    '| Map | Ids | Example | |\n| --- | --- | --- | --- |\n' + rows.join('\n'),
    skipped.includes('AreaEnemies')
      ? '`AreaEnemies` is a lookup table rather than ids: `AreaEnemies[CombatAreas.GolbinForest]` lists the enemies you can fight there. The [combat guide](/guides/combat/) uses it.'
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

// ---------------------------------------------------------------------------
// reference overview, changelog
// ---------------------------------------------------------------------------

function indexPage(pages: RefPage[]): string {
  const card = (href: string, title: string, description: string) =>
    `  <LinkCard href="${href}" title=${JSON.stringify(title)} description=${JSON.stringify(description)} />`;
  return [
    `---\ntitle: Reference\ndescription: Every call, property, result, event and error, generated from the source.\nsidebar:\n  order: 0\n  label: Overview\n---\n\n{/* Generated by tools/docs-site.ts. */}`,
    "import { Badge, CardGrid, LinkCard } from '@astrojs/starlight/components';",
    "Everything a script can do, generated from the code: it's the same text VS Code shows when you hover over a call. New to all this? The [guides](/guides/skills/) show these calls in use.",
    '## How to read it',
    '- <Badge text="Scripted Mode cooldown" variant="caution" /> A Scripted Mode action. It happens at once, then the cooldown runs, and an awaited call resolves when you may act again. Calling it while `m.ready` is false fails at once with `COOLDOWN`.',
    '- <Badge text="One switch per second" variant="note" /> Changes what the character is doing in real time. The game allows one such switch per second.',
    '- <Badge text="No cooldown" variant="success" /> Talks to the game (or waits) without any pacing. Use it any time.',
    '- Properties (no badge) are synchronous: they read the live state the game pushes to your script, so they cost nothing.',
    '- **Used in** links go to the guides, lessons and concept pages that show a call in use.',
    '## The API',
    '<CardGrid>',
    ...pages.map((p) => card(`/reference/${p.slug}/`, p.title, p.description)),
    '</CardGrid>',
    '## Types and tools',
    '<CardGrid>',
    card('/reference/state/', 'm.state', 'The live mirror of the game.'),
    card('/reference/types/', 'Results', 'What calls resolve with.'),
    card('/reference/events/', 'Events', 'm.on(type, handler)'),
    card('/reference/errors/', 'Errors', 'Error codes and MelvorError.'),
    card('/reference/protocol/', 'Protocol', 'Every JSON-RPC call, and Connection.'),
    card('/reference/cli/', 'CLI', 'bunx melvor2 <command>'),
    card('/reference/ids/', 'Ids', 'Search every typed id.'),
    '</CardGrid>',
  ].join('\n\n');
}

function changelogPage(): string {
  const file = join(ROOT, 'CHANGELOG.md');
  const head = `---\ntitle: Changelog\ndescription: Every release, newest first.\n---\n\n<!-- Generated by tools/docs-site.ts from CHANGELOG.md. -->\n\n`;
  if (!existsSync(file))
    return `${head}No releases yet. The first one will be listed here, with links to its release notes and download.\n\nUntil then, the [commit history](https://github.com/c3d-gg/melvor2-script/commits/main) shows what changed.\n`;
  const text = readFileSync(file, 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/^# Changelog\s*\n/, '')
    .replace(/^## \[([^\]]+)\]\(([^)]+)\) - (\S+)/gm, '## $1 ($3)\n\n[Release notes and download]($2)');
  return head + text;
}

// ---------------------------------------------------------------------------
// coverage
// ---------------------------------------------------------------------------

interface Coverage {
  $comment?: string;
  /** Members that only the reference needs to show, with the reason. */
  referenceOnly: Record<string, string>;
  /** Members still waiting for a guide or lesson. This list may only shrink. */
  todo: string[];
}

function checkCoverage(all: ApiMember[], pages: DocPage[], cov: Coverage): { problems: string[]; uncovered: string[] } {
  const problems: string[] = [];
  const uncovered: string[] = [];
  const known = new Set(all.map((m) => m.id));
  for (const m of all) {
    if (!m.doc.trim())
      problems.push(`${m.id}: no doc comment. Add one in src/client/ (VS Code shows it on hover too).`);
    const covered = usedIn(m, pages).length > 0;
    if (covered) {
      if (cov.todo.includes(m.id))
        problems.push(`${m.id} is in a guide now: run \`bun run docs:site --todo\` to take it off the todo list.`);
      continue;
    }
    if (m.id in cov.referenceOnly) continue;
    uncovered.push(m.id);
    if (!cov.todo.includes(m.id))
      problems.push(
        `${m.id}: no guide, lesson or concept page shows it. Add it to the guide for its system (see site/CONTRIBUTING.md), or list it under "referenceOnly" in site/coverage.json with the reason.`,
      );
  }
  for (const id of [...Object.keys(cov.referenceOnly), ...cov.todo])
    if (!known.has(id)) problems.push(`site/coverage.json lists ${id}, which isn't in the API any more.`);
  return { problems, uncovered };
}

/** Doc comments the generated pages rely on, besides the members (types, codes, calls). */
function missingTypeDocs(): string[] {
  const protocol = source('protocol');
  const out: string[] = [];
  for (const n of [...RESULT_TYPES, ...STATE_TYPES])
    if (!doc(iface(protocol, n))) out.push(`${n}: no doc comment in src/shared/protocol.ts.`);
  for (const c of errorCodes())
    if (!c.doc) out.push(`ErrorCode '${c.code}': no doc comment in src/shared/protocol.ts.`);
  for (const r of rpcs()) if (!r.doc) out.push(`Methods '${r.method}': no doc comment in src/shared/protocol.ts.`);
  for (const e of events()) if (!e.doc) out.push(`GameEvent '${e.type}': no doc comment in src/shared/protocol.ts.`);
  return out;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const refPages = buildPages();
const pages = docPages();
const allMembers = [
  ...new Map(refPages.flatMap((p) => p.groups.flatMap((g) => g.members)).map((m) => [m.id, m])).values(),
];
const covFile = join(SITE, 'coverage.json');
const cov: Coverage = JSON.parse(readFileSync(covFile, 'utf8'));

if (TODO) {
  const { uncovered } = checkCoverage(allMembers, pages, { ...cov, todo: [] });
  writeFileSync(
    covFile,
    formatted(JSON.stringify({ ...cov, todo: uncovered.sort() }, null, 2) + '\n', '.json', 'site'),
  );
  console.log(`site/coverage.json: ${uncovered.length} members still to cover.`);
  process.exit(0);
}

if (CHECK) {
  const { problems, uncovered } = checkCoverage(allMembers, pages, cov);
  for (const p of refPages)
    if (!p.intro.trim()) problems.push(`${p.title}: no doc comment, so the reference page has no introduction.`);
  problems.push(...missingTypeDocs());
  if (problems.length) {
    console.error(`✖ The docs need attention:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  const total = allMembers.length;
  const refOnly = Object.keys(cov.referenceOnly).length;
  console.log(
    `Docs OK: ${total - uncovered.length - refOnly} of ${total} calls and properties are in a guide, lesson or concept page, ${refOnly} ${refOnly === 1 ? 'is' : 'are'} reference-only, ${uncovered.length} to do.`,
  );
  process.exit(0);
}

const { maps, ids, skipped } = readIds();
rmSync(REF, { recursive: true, force: true });
mkdirSync(REF, { recursive: true });
const write = (file: string, text: string) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
};
for (const p of refPages) write(join(REF, `${p.slug}.mdx`), pageMdx(p, pages));
write(join(REF, 'index.mdx'), indexPage(refPages) + '\n');
write(join(REF, 'state.mdx'), statePage() + '\n');
write(join(REF, 'types.mdx'), typesPage() + '\n');
write(join(REF, 'events.mdx'), eventsPage() + '\n');
write(join(REF, 'errors.mdx'), errorsPage() + '\n');
write(join(REF, 'protocol.mdx'), protocolPage() + '\n');
write(join(REF, 'cli.mdx'), cliPage() + '\n');
write(join(REF, 'ids.mdx'), idsPage(maps, skipped) + '\n');
write(join(DOCS, 'changelog.md'), changelogPage());
write(join(SITE, 'public/ids.json'), JSON.stringify({ maps: maps.map((m) => m.name), ids }));
console.log(
  `docs site: ${refPages.length + 8} reference pages, ${ids.length} ids, changelog (${pages.length} hand-written pages scanned)`,
);
