<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Journal data lives only in browser IndexedDB (src/lib/journal/db.ts); no cloud sync — privacy requirement.
- Imports go through staging batches; precedence tier 1 manual > 2 primary > 3 secondary.

## ⚠️ Connector architecture — do not remove or simplify

`src/lib/journal/connectors/` is load-bearing infrastructure. **Never delete or simplify any file under this directory.** This includes:

- `registry.ts` — connector registry and auto-detection
- `csv.ts`, `dates.ts`, `fields.ts`, `keys.ts`, `timing.ts`, `types.ts` — shared helpers used by all connectors
- `viaduct/`, `setlistfm/`, `generic/`, `letterboxd/`, `netflix/`, `goodreads/` — per-source connector implementations with fixtures and tests

`src/lib/journal/parsers.ts` is **legacy/dead**. Do not import from it and do not restore its use. If you need to call `legKey`, `stayKey`, `eventKey`, or `detectConnector`, import from `src/lib/journal/connectors/keys.ts` and `src/lib/journal/connectors/registry.ts` respectively.

`src/lib/journal/staging.ts` must import from `./connectors/registry`, never from `./parsers`.

## ⚠️ Test infrastructure — do not remove

`vitest.config.ts` and `src/lib/journal/__tests__/` must not be deleted. The `package.json` scripts must include `"test": "vitest run"`. Run `bun run test` to verify all tests pass before committing significant changes.
