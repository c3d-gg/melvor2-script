# Writing the docs

The docs site (https://c3d-gg.github.io/melvor2-script/) is for two kinds of reader: people who already write
TypeScript and want answers fast, and people learning to code through this mod. Every page is written for one of them,
and links to the other where it helps.

```sh
bun install                # at the repo root, once: the generator needs TypeScript
cd site && bun install     # once
bun run dev                # http://localhost:4321/melvor2-script/, reloads as you edit
bun run build              # what CI and the Pages deploy run
bun run docs:site --check  # (from the repo root) the coverage check CI runs
bun run docs               # (from the repo root) regenerates docs/API.md, the one-page reference
```

## How the site is organised

| Section    | Folder                        | Reader      | Job                                                            |
| ---------- | ----------------------------- | ----------- | -------------------------------------------------------------- |
| Start here | `src/content/docs/start/`     | experienced | Install and the rules that matter, fast                        |
| Concepts   | `src/content/docs/concepts/`  | everyone    | How it works, Real time, Scripted Mode: the rules, explained   |
| Learn      | `src/content/docs/learn/`     | new to code | A course: one programming idea per lesson, through the game    |
| Guides     | `src/content/docs/guides/`    | everyone    | One page per game system: how to do things, with code          |
| Reference  | `src/content/docs/reference/` | experienced | **Generated.** Every call, from the doc comments               |
| Project    | `roadmap.mdx`, `changelog.md` | everyone    | Roadmap (from `roadmap.json`), changelog (from `CHANGELOG.md`) |

The Start here and Concepts pages are listed by hand in the sidebar (`astro.config.mjs`); Learn, Guides and Reference
list themselves (order them with `sidebar.order` in the front matter).

Generated, never edit by hand (they're gitignored): `src/content/docs/reference/`, `src/content/docs/changelog.md`,
`public/ids.json`. `tools/docs-site.ts` writes them from the client source (`src/client/`, `src/shared/protocol.ts`),
the CLI's help text (`src/cli/main.ts`), `CHANGELOG.md` and the id maps. `bun run build` runs it first.

## Where does a change go?

| You added…                               | Do this                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A call or property                       | A doc comment in `src/client/` (the reference and VS Code hovers use it), and a mention in its system's guide |
| An RPC, a state field, an error code     | A doc comment in `src/shared/protocol.ts`: the reference's protocol, state and errors pages are made from it  |
| A whole game system (e.g. Thieving)      | A new guide page from `templates/guide.mdx`, and a `roadmap.json` move from `next` to `available`             |
| Something every script must understand   | A section on a concept page (or a new one from `templates/concept.mdx`, added to the sidebar)                 |
| A programming idea beginners need for it | A lesson from `templates/lesson.mdx`, in course order (see `learn/index.mdx`)                                 |
| A complete, runnable script              | `examples/`, and pull it into the guide with `<Snippet file="examples/....ts" />`                             |
| A CLI command                            | A line in the `HELP` text in `src/cli/main.ts`: the CLI reference page is made from it                        |

CI enforces the first two rows: `bun run docs:site --check` fails when a public call or property has no doc comment or
no guide, lesson or concept page shows it, and when a result type, error code, event or RPC has no doc comment. If
something only belongs in the reference (a debugging tool, say), list it under `referenceOnly` in `coverage.json` with
the reason. `todo` is for calls that land before their guide; it may only shrink, and `bun run docs:site --todo`
rewrites it after you cover something.

## Code samples

**Every code sample is a real file that `bun run typecheck` checks**, so the docs can't fall out of date without CI
failing.

- Put samples in `snippets/<section>/<page>.ts`. They import `melvor2-script` like a real script (the root
  `tsconfig.json` maps it to the source). They never run.
- Show a whole file: `<Snippet file="site/snippets/learn/first-script.ts" title="scripts/first.ts" />`. Paths are from
  the repo root.
- Show part of one: wrap it in `// #region name` … `// #endregion`, then `<Snippet file="..." region="name" />`. The
  markers never show, and the code is dedented. One file per page with a region per sample works well
  (`snippets/guides/skills.ts`).
- A sample with a file name as its `title` (`scripts/golbins.ts`) says "copy me and run": make it a whole file,
  imports included (`snippets/guides/combat-session.ts`). Regions are for fragments, shown without a file name.
- `mark={[3, 5]}`, `ins`, `del` and other [Expressive Code](https://expressive-code.com) props pass through.
- Use real ids from `src/shared/ids.generated.ts` (Melvor 2's aren't Melvor 1's), and levels and amounts that work as
  written: `WoodcuttingRecipes.NormalTree` needs level 1, `OakTree` level 10.
- A one-line fragment inside prose (`` `m.combat.hp` ``) is fine inline. Anything a reader might copy and run belongs in
  a snippet.

## Components

From Starlight (`import { … } from '@astrojs/starlight/components'`):

- `<Tabs syncKey="…">` / `<TabItem label="…">`. Use the shared sync keys, so a reader's choice follows them around the
  site: `mode` (Real time / Scripted Mode), `style-of-script` (Await style / Loop style), `install` (From GitHub / From
  source).
- `<Steps>` around a numbered list, for instructions done in order.
- `<Aside type="tip|caution|danger" title="…">`. In lessons, a box titled "New idea: …" introduces a term.
- `<Card>`, `<CardGrid>`, `<LinkCard>`, `<Badge>`.

Ours (`src/components/`):

- `<Snippet>`: code from a real file (above).
- `<Goals build={[…]} learn={[…]} time="20 minutes" />`: the top of a lesson.
- `<Challenge title="…">task<Snippet slot="solution" … /></Challenge>`: a task with a hidden solution.
- `<Install />`: the install commands, pinned to the version in the root `package.json`. `<Install part="update" />`:
  just the upgrade lines.
- `<IdSearch />`, `<Roadmap />`: the id search and the roadmap.

Styled HTML you can use in MDX (`src/styles/custom.css`): `<ul class="req-strip">` (a row of facts),
`<ol class="chain">` (numbered steps joined by a line, as on How it works), `<div class="timeline">` (act and cooldown
bars, as on Scripted Mode), `<div class="doors">` (the landing page's two doors).

Link between pages with plain absolute paths (`/guides/combat/`); a remark plugin adds the `/melvor2-script` prefix.
Inside our own components, use `import.meta.env.BASE_URL`.

## Voice

Both readers:

- Plain words, short sentences. Say what a thing does before how it works.
- Concrete over abstract: a real item, enemy or number, not "some value".
- Every code sample runs as shown (with the right levels and items).
- Name the pacing: say when something uses the Scripted Mode cooldown, counts as a real-time switch, or is free.

Lessons (new to code):

- Open with what they'll make, in game terms. Teach only what that needs.
- Introduce each new word once, in bold, with a plain definition, then use it consistently.
- Walk through new code line by line. Show the common mistake and what the error looks like.
- End with two or three challenges that each change one thing, with a solution in a snippet.
- The course uses Scripted Mode (lesson 1 turns it on), so `act()` paces every loop.

Guides and the reference (experienced, in a hurry):

- Lead with the code. Keep prose to what the code doesn't say.
- Put the caveats where people will hit them (`fight()` doesn't eat for you).
- Show both modes with `<Tabs syncKey="mode">` when they behave differently.
- Link to the reference for the full signature rather than repeating it.

## After a feature, the checklist

1. Doc comments on every new public call, property and type in `src/client/` and `src/shared/protocol.ts` (VS Code
   shows them too).
2. The guide for that system shows the new calls, with samples in `snippets/` (or a new guide from the template).
3. `roadmap.json` updated if a roadmap item shipped.
4. `bun run docs`, `bun run docs:site --check` and `bun run typecheck` pass; `bun run build` in `site/` builds.
5. Look at it: `bun run dev` in `site/`.

The site deploys when a release is published (`.github/workflows/pages.yml`), so it always matches the version people
install. Docs fixes between releases: `gh workflow run pages.yml -f ref=main`.
