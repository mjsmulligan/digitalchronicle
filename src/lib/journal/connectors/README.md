# How to add a connector

A connector is a folder under `src/lib/journal/connectors/` that encapsulates
everything about one import source: parsing, format detection, and tests.
Adding a new source means touching only that folder and `registry.ts`.

## Checklist

1. **Create the folder**

   ```
   src/lib/journal/connectors/myservice/
   ├── index.ts          ← exports `connector: Connector`
   ├── fixtures/
   │   └── sample.csv    ← (or .json) a real or representative sample file
   └── myservice.test.ts ← connector-specific tests
   ```

2. **Implement `Connector` in `index.ts`**

   ```ts
   import type { Connector } from "../types";

   export const connector: Connector = {
     id: "myservice",          // stored in IndexedDB as entry.source — never change this
     label: "My Service",      // shown in the UI dropdown
     kind: "file",             // "file" | "api"
     tier: 2,                  // default precedence (1 manual > 2 primary > 3 secondary)
     accepts: [".csv"],        // file-input accept hints

     sniff(name, head) {
       // Return 0..1. Higher wins. Called with lowercased first-400-char head.
       if (/myservice/i.test(name) || head.includes("myservice_column")) return 0.9;
       return 0;
     },

     parse({ name, text }) {
       // Return a ParseResult (sync or async).
       // entry.source MUST equal this connector's id.
       // entry.dedupeKey MUST be set before returning.
     },
   };
   ```

   - `id` is stored in IndexedDB. Once you ship it, treat it as immutable.
   - Use helpers from the sibling files: `csv.ts`, `dates.ts`, `fields.ts`,
     `keys.ts`, `timing.ts`.
   - Do **not** add network calls. All parsing must be offline / client-side.

3. **Copy a representative sample into `fixtures/`**

   This is the file the connector test and CI will parse. It should cover
   typical columns and at least one edge case (e.g. a missing optional field).

4. **Write a test in `myservice.test.ts`**

   At minimum: metadata assertions, a parse of the fixture with zero errors, and
   sniff score assertions. See `viaduct/viaduct.test.ts` for a template.

5. **Register in `registry.ts`**

   ```ts
   import { connector as myservice } from "./myservice/index";

   export const CONNECTORS: Connector[] = [
     setlistfm, viaduct, myservice, generic,   // specific before generic (tiebreaker)
   ];
   ```

   The `<select>` in the import UI and the file-input `accept` list are built
   automatically from `CONNECTORS` — no other UI changes needed.

6. **Run tests**

   ```bash
   bun run test
   ```

   This runs vitest via the npm script. All existing characterization snapshots
   must still pass. New connector tests must also pass.

   In CI (or to catch snapshot drift rather than auto-heal it):

   ```bash
   bunx vitest run --ci
   ```

## File-input `accept` and the drop-zone

The import page derives the `accept` attribute from `connector.accepts`.
If your connector handles files with an unusual extension, add it to `accepts`.

## Unsupported formats

If a format should be explicitly rejected with a clear message (not silently
mis-parsed), add an entry to `UNSUPPORTED_FORMATS` in `registry.ts`.
See the Flightradar24 entry as a reference.

## API connectors (future)

Set `kind: "api"`. The `parse` function is not called for API connectors; a
future `sync()` method will be added to the interface when the first API
connector is implemented. Stub `sync` as a comment for now.
