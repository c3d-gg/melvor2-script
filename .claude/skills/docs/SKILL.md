---
name: docs
description: Bring the melvor2-script docs site up to date after a change to the client API or protocol. Finds public calls with no doc comment or no guide coverage, drafts the missing guide sections and code samples from the site's templates, builds the site and checks it. Use after adding or changing anything in src/client/ or src/shared/protocol.ts, before a release, or when asked to update the docs.
---

# Update the docs site

The rules for what goes where and how to write it are in `site/CONTRIBUTING.md`. Read it first, every time.

Never run scripts, examples or `bun run melvor2 …` against the game to check the docs: the user plays on their own save.
Everything below works without the game.

1. **See what's missing.** From the repo root:

   ```sh
   bun run docs:site --check
   ```

   It lists public calls and properties with no doc comment, calls no guide, lesson or concept page shows, result
   types, error codes, events and RPCs without doc comments, and stale `site/coverage.json` entries. Nothing listed and
   nothing new in the diff? Say so and stop.

2. **Doc comments first.** For each "no doc comment", write one in `src/client/` or `src/shared/protocol.ts` in the
   style of its neighbours: what it does, what it resolves with, when the game refuses (error codes), and how it's
   paced (Scripted Mode cooldown, a real-time switch, or free). Doc comments only: never change code to fix the docs.
   Then `bun run docs` (docs/API.md).

3. **Guide coverage.** For each uncovered call, decide where it belongs using the table in CONTRIBUTING.md:
   - a call in a system that has a guide: add it to that guide, in the section where a reader would look for it;
   - a new system: create `site/src/content/docs/guides/<system>.mdx` from `site/templates/guide.mdx`;
   - a rule every script must know: the concept pages (`how-it-works`, `real-time`, `scripted-mode`);
   - only useful in the reference: add it to `referenceOnly` in `site/coverage.json`, with the reason.

   Put every code sample a reader might copy in `site/snippets/guides/<system>.ts` as a `// #region`, and show it with
   `<Snippet file="..." region="..." />`. Use real ids from `src/shared/ids.generated.ts` and amounts that work at the
   levels the text assumes. Check signatures in `src/client/melvor.ts` and the runtime's behaviour in `mod/runtime/`
   rather than guessing. When real time and Scripted Mode differ, show both in `<Tabs syncKey="mode">`.

4. **New programming ideas.** If the feature needs an idea the course hasn't taught, note it for a lesson (see
   `site/src/content/docs/learn/index.mdx`) rather than writing a lesson unasked.

5. **Roadmap.** If a roadmap item shipped, move it from `next` to `available` in `site/roadmap.json`.

6. **Verify.**

   ```sh
   bun run docs:site --todo     # only if you covered items from the todo list
   bun run typecheck            # type-checks the snippets
   bun run docs:site --check
   bun run docs --check
   bun fmt --check
   cd site && bun run build
   ```

   All must pass. Then `cd site && bun run dev` (background) and look at the changed pages, or screenshot them with a
   headless browser. Check that tabs, snippets and links render.

7. **Report** which pages changed and what's still on the todo list. Don't commit unless asked.
