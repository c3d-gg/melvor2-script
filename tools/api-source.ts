/**
 * Reads the client's public API from the TypeScript source: classes, members, doc comments and
 * types, and arranges it into the pages of the reference. Shared by tools/api-docs.ts (docs/API.md)
 * and tools/docs-site.ts (the docs site), so both always say the same thing.
 */
import ts from 'typescript';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..').replace(/\\/g, '/');
export const FILES = {
  index: 'src/client/index.ts',
  melvor: 'src/client/melvor.ts',
  connection: 'src/client/connection.ts',
  protocol: 'src/shared/protocol.ts',
  ids: 'src/shared/ids.generated.ts',
};

export const program = ts.createProgram(
  Object.values(FILES).map((f) => `${ROOT}/${f}`),
  {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.Preserve,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    strict: true,
    noEmit: true,
    types: ['bun'],
  },
);
export const checker = program.getTypeChecker();
export const source = (key: keyof typeof FILES) => {
  const sf = program.getSourceFile(`${ROOT}/${FILES[key]}`);
  if (!sf) throw new Error(`can't load ${FILES[key]}`);
  return sf;
};

// ---------------------------------------------------------------------------
// reading the source
// ---------------------------------------------------------------------------

export type Named = ts.ClassDeclaration | ts.InterfaceDeclaration | ts.TypeAliasDeclaration | ts.FunctionDeclaration;

export function find<T extends Named>(sf: ts.SourceFile, name: string, is: (n: ts.Node) => n is T): T {
  for (const st of sf.statements) if (is(st) && st.name?.text === name) return st;
  throw new Error(`${name} not found in ${sf.fileName}`);
}
export const cls = (sf: ts.SourceFile, name: string) => find(sf, name, ts.isClassDeclaration);
export const iface = (sf: ts.SourceFile, name: string) => find(sf, name, ts.isInterfaceDeclaration);
export const alias = (sf: ts.SourceFile, name: string) => find(sf, name, ts.isTypeAliasDeclaration);
export const fn = (sf: ts.SourceFile, name: string) => find(sf, name, ts.isFunctionDeclaration);

export const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

export function isInternal(node: ts.Node): boolean {
  return ts.getJSDocTags(node).some((t) => t.tagName.text === 'internal');
}

/** The doc comment on a declaration (without tags). */
export function doc(node: ts.Node & { name?: ts.Node }): string {
  const sym = node.name ? checker.getSymbolAtLocation(node.name) : undefined;
  if (sym) return ts.displayPartsToString(sym.getDocumentationComment(checker)).trim();
  return leadingDoc(node);
}

/** A `/** ... *\/` comment right before a node that isn't a JSDoc host (union members). */
export function leadingDoc(node: ts.Node, from = node.pos): string {
  // The last doc comment between `from` and the node. A union member's comment sits before
  // its `|`, outside the member's own range, so callers pass where the previous member ended.
  const text = node.getSourceFile().text.slice(from, node.getStart());
  const last = [...text.matchAll(/\/\*\*([\s\S]*?)\*\//g)].at(-1);
  if (!last) return '';
  return last[1]!
    .split('\n')
    .map((l) => l.replace(/^\s*\* ?/, ''))
    .join('\n')
    .trim();
}

/** Inferred types name other files as import("C:/...").Type: keep just the name. */
export const local = (s: string) => s.replace(/import\("[^"]*"\)\./g, '');

export function typeText(node: ts.Node, typeNode: ts.TypeNode | undefined): string {
  if (typeNode) return flat(typeNode.getText());
  return local(checker.typeToString(checker.getTypeAtLocation(node), node, ts.TypeFormatFlags.NoTruncation));
}

export interface Member {
  kind: 'property' | 'method';
  name: string;
  sig: string;
  doc: string;
  /**
   * Methods only. 'cooldown': a Scripted Mode action, paced by the shared cooldown.
   * 'switch': changes the active action in real time (at most one switch per second).
   * 'free': talks to the game or waits, with no pacing. Undefined: synchronous.
   */
  pace?: 'cooldown' | 'switch' | 'free';
}

/** The RPCs that change the active action in real time, limited to one per second by the runtime. */
const SWITCH_CALLS = /['"](skill\.start|combat\.fight)['"]/;

/** A method as `this.name` would find it from `c`. */
function methodFrom(c: ts.ClassDeclaration, name: string): ts.MethodDeclaration | undefined {
  return c.members.find((x): x is ts.MethodDeclaration => ts.isMethodDeclaration(x) && x.name.getText() === name);
}

/** How a method body is paced: through `_act` (the Scripted Mode cooldown), or a switch RPC. */
function paceOf(
  body: string,
  async: boolean,
  c?: ts.ClassDeclaration,
  seen = new Set<string>(),
): Member['pace'] | undefined {
  if (/\b_act\(/.test(body)) return 'cooldown';
  if (SWITCH_CALLS.test(body)) return 'switch';
  if (c)
    for (const [, name] of body.matchAll(/\bthis\.(\w+)\(/g)) {
      const target = methodFrom(c, name!);
      if (!target || seen.has(name!)) continue;
      seen.add(name!);
      const p = paceOf(target.body?.getText() ?? '', false, c, seen);
      if (p && p !== 'free') return p;
    }
  return async ? 'free' : undefined;
}

export function isPublic(node: ts.Node): boolean {
  const flags = ts.getCombinedModifierFlags(node as ts.Declaration);
  return !(flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected));
}

const returnsPromise = (ret: string) => ret.startsWith('Promise<');

/** A class's own public members, in source order. */
export function members(c: ts.ClassDeclaration): Member[] {
  const out: Member[] = [];
  for (const m of c.members) {
    if (ts.isConstructorDeclaration(m)) {
      // `readonly id: string` constructor parameters are properties too.
      for (const p of m.parameters) {
        const flags = ts.getCombinedModifierFlags(p);
        if (!(flags & (ts.ModifierFlags.Readonly | ts.ModifierFlags.Public)) || !isPublic(p)) continue;
        if (!ts.isIdentifier(p.name) || p.name.text.startsWith('_')) continue;
        out.push({ kind: 'property', name: p.name.text, sig: `${p.name.text}: ${typeText(p, p.type)}`, doc: doc(p) });
      }
      continue;
    }
    if (!m.name || !ts.isIdentifier(m.name) || m.name.text.startsWith('_') || !isPublic(m) || isInternal(m)) continue;
    const name = m.name.text;
    if (ts.isMethodDeclaration(m)) {
      const sig = checker.getSignatureFromDeclaration(m)!;
      const ret = m.type
        ? flat(m.type.getText())
        : local(checker.typeToString(checker.getReturnTypeOfSignature(sig), m, ts.TypeFormatFlags.NoTruncation));
      const tps = m.typeParameters ? `<${m.typeParameters.map((t) => flat(t.getText())).join(', ')}>` : '';
      const params = m.parameters.map((p) => flat(p.getText())).join(', ');
      const async = returnsPromise(ret) || !!m.modifiers?.some((x) => x.kind === ts.SyntaxKind.AsyncKeyword);
      const pace = paceOf(m.body?.getText() ?? '', async, c);
      out.push({ kind: 'method', name, sig: `${name}${tps}(${params}): ${ret}`, doc: doc(m), pace });
    } else if (ts.isGetAccessor(m) || ts.isPropertyDeclaration(m)) {
      out.push({ kind: 'property', name, sig: `${name}: ${typeText(m, m.type)}`, doc: doc(m) });
    }
  }
  return out;
}

/**
 * Members of an object built inline, like `readonly combat = (() => { ...; return { fight: (...) => ..., get hp() {...} }; })()`:
 * arrow-function properties are methods, getters are properties.
 */
export function objectMembers(prop: ts.PropertyDeclaration): Member[] {
  let obj: ts.ObjectLiteralExpression | undefined;
  const visit = (n: ts.Node) => {
    if (obj) return;
    if (ts.isReturnStatement(n) && n.expression && ts.isObjectLiteralExpression(n.expression)) obj = n.expression;
    else if (ts.isObjectLiteralExpression(n) && n.parent === prop) obj = n;
    else ts.forEachChild(n, visit);
  };
  if (prop.initializer) visit(prop.initializer);
  if (!obj) throw new Error(`${prop.name.getText()}: no object literal found`);
  const out: Member[] = [];
  for (const p of obj.properties) {
    if (!p.name || !ts.isIdentifier(p.name) || p.name.text.startsWith('_')) continue;
    const name = p.name.text;
    if (ts.isGetAccessor(p)) {
      out.push({ kind: 'property', name, sig: `${name}: ${typeText(p, p.type)}`, doc: doc(p) });
    } else if (
      ts.isPropertyAssignment(p) &&
      (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))
    ) {
      const f = p.initializer;
      const sig = checker.getSignatureFromDeclaration(f)!;
      const ret = f.type
        ? flat(f.type.getText())
        : local(checker.typeToString(checker.getReturnTypeOfSignature(sig), f, ts.TypeFormatFlags.NoTruncation));
      const params = f.parameters.map((x) => flat(x.getText())).join(', ');
      const pace = paceOf(f.body.getText(), returnsPromise(ret));
      out.push({ kind: 'method', name, sig: `${name}(${params}): ${ret}`, doc: doc(p), pace });
    } else if (ts.isMethodDeclaration(p)) {
      const sig = checker.getSignatureFromDeclaration(p)!;
      const ret = local(
        checker.typeToString(checker.getReturnTypeOfSignature(sig), p, ts.TypeFormatFlags.NoTruncation),
      );
      const params = p.parameters.map((x) => flat(x.getText())).join(', ');
      out.push({
        kind: 'method',
        name,
        sig: `${name}(${params}): ${ret}`,
        doc: doc(p),
        pace: paceOf(p.body?.getText() ?? '', returnsPromise(ret)),
      });
    }
  }
  return out;
}

/** Fields of an interface (or an object type literal). */
export function fields(
  node: ts.InterfaceDeclaration | ts.TypeLiteralNode,
): { name: string; type: string; doc: string }[] {
  return node.members.filter(ts.isPropertySignature).map((p) => ({
    name: `${p.name.getText()}${p.questionToken ? '?' : ''}`,
    type: flat(p.type?.getText() ?? 'unknown'),
    doc: doc(p),
  }));
}

/** Doc text as markdown: indented lines in a comment are code examples. */
export function md(text: string, indent = ''): string {
  if (!text) return '';
  const lines = text.split('\n');
  const out: string[] = [];
  let code: string[] | null = null;
  const flush = () => {
    if (!code) return;
    const pad = Math.min(...code.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length));
    out.push('```ts', ...code.map((l) => l.slice(pad)).filter((l, i, a) => l || i < a.length - 1), '```');
    code = null;
  };
  for (const l of lines) {
    // A list item ("- foo") followed by an indented continuation isn't code: only 4+ spaces are.
    if (/^ {4,}\S/.test(l) || (code && !l.trim())) (code ??= []).push(l);
    else {
      flush();
      out.push(l.replace(/^ {1,3}(?=\S)/, ''));
    }
  }
  flush();
  return out.map((l) => (l ? indent + l : l)).join('\n');
}

/** The first sentence of a doc comment, without code marks (for card descriptions). */
export function firstSentence(text: string): string {
  const s = flat(text.split('\n\n')[0] ?? '');
  const end = s.search(/\.(\s|$)/);
  return (end > 0 ? s.slice(0, end + 1) : s).replace(/`/g, '');
}

// ---------------------------------------------------------------------------
// the reference, page by page
// ---------------------------------------------------------------------------

export interface ApiMember extends Member {
  /** e.g. 'm.count', 'm.combat.fight', or 'm.skills.*.level' for members every skill has. */
  id: string;
  /** Finds the member in guide and lesson text. */
  usage: RegExp;
}
export interface Group {
  title?: string;
  intro?: string;
  members: ApiMember[];
}
export interface RefPage {
  slug: string;
  title: string;
  description: string;
  order: number;
  intro: string;
  groups: Group[];
  /** Extra markdown after the groups. */
  after?: string;
}

function usageFor(path: string, name: string): RegExp {
  if (path === 'm') return new RegExp(`\\bm\\.${name}\\b`);
  if (path === 'm.skills.*') return new RegExp(`\\bskills\\.\\w+\\.${name}\\b`);
  const last = path.split('.').at(-1)!;
  return new RegExp(`\\b${last}\\.${name}\\b`);
}

const withIds = (list: Member[], path: string): ApiMember[] =>
  list.map((m) => ({ ...m, id: `${path}.${m.name}`, usage: usageFor(path, m.name) }));

/** `m`'s members, sorted into sections. Members not named here land in "More". */
const M_SECTIONS: [title: string, intro: string, names: string[]][] = [
  [
    'Live state',
    'Synchronous reads of the state the game pushes, and ways to wait for it to change.',
    ['state', 'count', 'gp', 'onState', 'waitFor', 'on'],
  ],
  [
    'Scripted Mode',
    'The settings and the cooldown. The actions themselves are `m.skills.<name>.act()`. See [Scripted Mode](/concepts/scripted-mode/).',
    ['scripted', 'speed', 'cooldown', 'ready', 'whenReady', 'setScripted'],
  ],
  ['Doing things', '', ['stop', 'log', 'loadSave']],
];
/** Sub-objects of `m` with their own page. */
export const SUB_APIS = ['skills', 'combat'];

/** Every Skills id key, as `m.skills.<key>` uses it. */
export function skillKeys(): string[] {
  const ids = source('ids');
  for (const st of ids.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== 'Skills' || !d.initializer) continue;
      const obj = ts.isAsExpression(d.initializer) ? d.initializer.expression : d.initializer;
      if (!ts.isObjectLiteralExpression(obj)) continue;
      return obj.properties.filter(ts.isPropertyAssignment).map((p) => {
        const k = p.name.getText();
        return k[0]!.toLowerCase() + k.slice(1);
      });
    }
  }
  return [];
}

export function buildPages(): RefPage[] {
  const melvor = source('melvor');
  const M = cls(melvor, 'Melvor');
  const prop = (name: string) => {
    const p = M.members.find(
      (x): x is ts.PropertyDeclaration => ts.isPropertyDeclaration(x) && x.name.getText() === name,
    );
    if (!p) throw new Error(`Melvor.${name} not found`);
    return p;
  };
  const pages: RefPage[] = [];

  // m and run()
  const runFn = fn(melvor, 'run');
  const runMember: ApiMember = {
    kind: 'method',
    name: 'run',
    sig: `run(${runFn.parameters.map((p) => flat(p.getText())).join(', ')})${runFn.type ? `: ${flat(runFn.type.getText())}` : ''}`,
    doc: doc(runFn),
    id: 'run',
    usage: /\brun\(/,
  };
  const all = withIds(members(M), 'm').filter((m) => !SUB_APIS.includes(m.name));
  const sections: Group[] = [{ title: 'Starting a script', members: [runMember] }];
  const placed = new Set<string>();
  for (const [title, intro, names] of M_SECTIONS) {
    const list = names.flatMap((n) => all.filter((m) => m.name === n));
    list.forEach((m) => placed.add(m.name));
    if (list.length) sections.push({ title, intro, members: list });
  }
  const rest = all.filter((m) => !placed.has(m.name));
  if (rest.length) sections.push({ title: 'More', intro: '', members: rest });
  pages.push({
    slug: 'm',
    title: 'm',
    description: 'The object every script gets: live state, Scripted Mode pacing, events, logging.',
    order: 1,
    intro: `${doc(M)}\n\nSkills and combat have their own pages: [\`m.skills\`](/reference/skills/) and [\`m.combat\`](/reference/combat/).`,
    groups: sections,
  });

  // m.skills
  const skill = cls(melvor, 'Skill');
  const keys = skillKeys();
  pages.push({
    slug: 'skills',
    title: 'm.skills',
    description: 'Every skill: level and XP, and the actions of gathering and crafting skills.',
    order: 2,
    intro: doc(prop('skills')),
    groups: [{ title: 'Every skill', intro: doc(skill), members: withIds(members(skill), 'm.skills.*') }],
    after: `## Skill names\n\n${keys.map((k) => `\`m.skills.${k}\``).join(', ')}.`,
  });

  // m.combat
  pages.push({
    slug: 'combat',
    title: 'm.combat',
    description: 'Fighting an enemy, eating, leaving combat, and your HP.',
    order: 3,
    intro: doc(prop('combat')),
    groups: [{ members: withIds(objectMembers(prop('combat')), 'm.combat') }],
  });
  return pages;
}

/** What calls resolve with (types page). */
export const RESULT_TYPES = ['ActionResult', 'ScriptedStatus', 'RecipeInfo', 'SaveInfo', 'RuntimeInfo'];
/** The live state (state page). */
export const STATE_TYPES = ['GameState', 'SkillState', 'ActiveAction'];

/** The codes of ErrorCode, each with its doc comment. */
export function errorCodes(): { code: string; doc: string }[] {
  const union = alias(source('protocol'), 'ErrorCode').type as ts.UnionTypeNode;
  return union.types.map((t, i, list) => ({
    code: t.getText().replace(/'/g, ''),
    doc: leadingDoc(t, i ? list[i - 1]!.end : t.parent.pos),
  }));
}

/** GameEvent's members: type, other fields, doc comment. */
export function events(): { type: string; fields: string; doc: string }[] {
  const union = alias(source('protocol'), 'GameEvent').type as ts.UnionTypeNode;
  return union.types.filter(ts.isTypeLiteralNode).map((t) => {
    const fs = fields(t);
    const type = fs.find((f) => f.name === 'type')!.type.replace(/'/g, '');
    const rest = fs.filter((f) => f.name !== 'type').map((f) => `${f.name}: ${f.type}`);
    const i = union.types.indexOf(t);
    return { type, fields: `{ ${rest.join('; ')} }`, doc: leadingDoc(t, i ? union.types[i - 1]!.end : t.parent.pos) };
  });
}

/** Every RPC in `Methods`: name, params, result, doc comment. */
export function rpcs(): { method: string; params: string; result: string; doc: string }[] {
  return iface(source('protocol'), 'Methods')
    .members.filter(ts.isPropertySignature)
    .map((p) => {
      const tuple = p.type && ts.isTupleTypeNode(p.type) ? p.type.elements : [];
      const params = tuple[0] ? flat(tuple[0].getText()) : 'void';
      return {
        method: p.name.getText().replace(/['"]/g, ''),
        params: params === 'void' ? '' : params,
        result: tuple[1] ? flat(tuple[1].getText()) : 'unknown',
        doc: doc(p),
      };
    });
}

/** Exported `const`s of protocol.ts (PROTOCOL_VERSION, DEFAULT_PORT), with their values. */
export function protocolConstants(): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const st of source('protocol').statements)
    if (ts.isVariableStatement(st))
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name) && d.initializer) out.push({ name: d.name.text, value: d.initializer.getText() });
  return out;
}

// ---------------------------------------------------------------------------
// the CLI, from its help text in src/cli/main.ts
// ---------------------------------------------------------------------------

export interface CliSection {
  /** e.g. 'Setup (no game needed)'; '' for commands before the first heading. */
  title: string;
  commands: { usage: string; about: string }[];
}

/**
 * The commands in the CLI's help text: the `const HELP = \`...\`` string in src/cli/main.ts (what
 * `bunx melvor2 help` prints), or else the comment at the top of the file. In either:
 *   Setup (no game needed)                               a heading: no indent
 *     install                   download the mod ...     a command: two or more spaces between the columns
 *                               ... more words           a line indented further continues the one above
 * Returns [] if the file or the list isn't there.
 */
export function cliCommands(): CliSection[] {
  const file = `${ROOT}/src/cli/main.ts`;
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const help = text.match(/const HELP = `([\s\S]*?)`;/)?.[1];
  const lines = help
    ? help.split('\n').slice(1) // the first line is the usage ("melvor2 <command>")
    : (text.match(/^(?:#!.*\n)?((?:\/\/.*\n)+)/)?.[1] ?? '').split('\n').map((l) => l.replace(/^\/\/ ?/, ''));
  const sections: CliSection[] = [{ title: '', commands: [] }];
  for (const line of lines) {
    if (!line.trim()) continue;
    const cmd = line.match(/^ {1,4}(\S(?:.*?\S)?) {2,}(\S.*)$/);
    const last = sections.at(-1)!;
    if (cmd) last.commands.push({ usage: cmd[1]!, about: cmd[2]!.trim() });
    else if (/^ {5,}\S/.test(line) && last.commands.length) last.commands.at(-1)!.about += ` ${line.trim()}`;
    else if (help && /^\S/.test(line)) sections.push({ title: line.trim(), commands: [] });
  }
  return sections.filter((s) => s.commands.length);
}

// ---------------------------------------------------------------------------
// ids
// ---------------------------------------------------------------------------

export interface IdMap {
  name: string;
  count: number;
  example: string;
  about: string;
}

/** Every id map in ids.generated.ts: { maps, ids: [map index, key, id, in-game name][] }. */
export function readIds(): { maps: IdMap[]; ids: [number, string, string, string][]; skipped: string[] } {
  const sf = source('ids');
  const maps: IdMap[] = [];
  const ids: [number, string, string, string][] = [];
  const skipped: string[] = [];
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || !d.initializer) continue;
      const obj = ts.isAsExpression(d.initializer) ? d.initializer.expression : d.initializer;
      if (!ts.isObjectLiteralExpression(obj)) continue;
      const entries = obj.properties.filter(
        (p): p is ts.PropertyAssignment =>
          ts.isPropertyAssignment(p) && ts.isStringLiteral(p.initializer) && ts.isIdentifier(p.name),
      );
      if (!entries.length) {
        skipped.push(d.name.text); // e.g. AreaEnemies: a lookup table, not ids
        continue;
      }
      const map: IdMap = { name: d.name.text, count: 0, example: '', about: leadingDoc(st) };
      maps.push(map);
      for (const e of entries) {
        const key = e.name.getText();
        const value = (e.initializer as ts.StringLiteral).text;
        const name = leadingDoc(e) || key.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
        if (!map.example) map.example = `${map.name}.${key}`;
        map.count++;
        ids.push([maps.length - 1, key, value, name]);
      }
    }
  }
  return { maps, ids, skipped };
}

// ---------------------------------------------------------------------------
// formatting generated files
// ---------------------------------------------------------------------------

/**
 * `text` as `bun fmt` would write it to a file with this extension (bunfig.toml's settings), so a
 * generated file passes `bun fmt --check` in CI. `dir` is where the temporary file goes (repo-relative).
 */
export function formatted(text: string, ext: string, dir = '.'): string {
  const tmp = `${ROOT}/${dir}/.generated-tmp-${process.pid}${ext}`;
  writeFileSync(tmp, text);
  try {
    const r = Bun.spawnSync([process.execPath, 'fmt', tmp], { cwd: ROOT, stdout: 'ignore', stderr: 'pipe' });
    if (r.exitCode !== 0) throw new Error(`bun fmt failed: ${r.stderr.toString()}`);
    return readFileSync(tmp, 'utf8');
  } finally {
    rmSync(tmp, { force: true });
  }
}
