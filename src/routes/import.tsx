import { createFileRoute } from "@tanstack/react-router";
import { SourceIcon } from "@/components/journal/SourceIcon";
import { useState } from "react";
import { Upload, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { importFile, type ImportResult } from "@/lib/journal/import";
import { SAMPLE_VIADUCT, SAMPLE_SETLIST, SAMPLE_GENERIC, SAMPLE_LIFE } from "@/lib/journal/samples";
import { sourceLabel } from "@/lib/journal/connectors/registry";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "Import — Journal" },
      { name: "description", content: "Import Viaduct, setlist.fm and custom CSV/JSON exports into your journal." },
      { property: "og:title", content: "Import — Journal" },
      { property: "og:description", content: "Drop a CSV or JSON export and it goes straight into your journal, flagged for review." },
    ],
  }),
  component: ImportPage,
});

// ─── Summary helpers ──────────────────────────────────────────────────────────

interface SummaryItem {
  filename: string;
  result: ImportResult;
}

function buildSummaryLines(result: ImportResult): { primary: string; secondary: string; errorLine: string } {
  const { added, updated, skipped, errors } = result;

  const countParts: string[] = [];
  if (added   > 0) countParts.push(`${added} new`);
  if (updated > 0) countParts.push(`${updated} updated`);
  const primary = countParts.length > 0 ? countParts.join(", ") + "." : "Nothing new.";

  const skipParts: string[] = [];
  const alreadyIn = skipped.duplicate + skipped.inFile;
  if (alreadyIn > 0) skipParts.push(`${alreadyIn} already in your journal`);
  if (skipped.removed === 1) skipParts.push("1 you hid earlier was skipped");
  else if (skipped.removed > 1) skipParts.push(`${skipped.removed} you hid earlier were skipped`);
  const secondary = skipParts.length > 0 ? skipParts.join(", ") + "." : "";

  const errorLine = errors.length > 0
    ? `${errors.length} ${errors.length === 1 ? "row" : "rows"} could not be read.`
    : "";

  return { primary, secondary, errorLine };
}

// ─── Result card ──────────────────────────────────────────────────────────────

function ResultCard({ item, onDismiss }: { item: SummaryItem; onDismiss: () => void }) {
  const { filename, result } = item;
  const { primary, secondary, errorLine } = buildSummaryLines(result);
  const nothing = result.added === 0 && result.updated === 0;
  const source = result.run?.source;

  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-card p-4">
      <CheckCircle2 className={cn("mt-0.5 h-5 w-5 shrink-0", nothing ? "text-muted-foreground" : "text-green-600 dark:text-green-500")} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-sm">{filename}</span>
          {source && (
            <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
              <SourceIcon source={source} />
              {sourceLabel(source)}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-foreground">{primary}</p>
        {secondary  && <p className="text-xs text-muted-foreground">{secondary}</p>}
        {errorLine  && (
          <p className="flex items-center gap-1 text-xs text-destructive">
            <AlertTriangle className="h-3 w-3" />{errorLine}
          </p>
        )}
        {result.errors.length > 0 && (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground underline">Show errors</summary>
            <ul className="mt-1 space-y-0.5 text-xs text-destructive">
              {result.errors.slice(0, 10).map((e, i) => <li key={i}>{e}</li>)}
              {result.errors.length > 10 && <li>...and {result.errors.length - 10} more</li>}
            </ul>
          </details>
        )}
      </div>
      <button className="shrink-0 text-muted-foreground hover:text-foreground" onClick={onDismiss} aria-label="Dismiss">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

function ImportPage() {
  const [src, setSrc] = useState("auto");
  const [drag, setDrag] = useState(false);
  const [importing, setImporting] = useState(false);
  const [summaries, setSummaries] = useState<SummaryItem[]>([]);

  const addSummary = (item: SummaryItem) =>
    setSummaries((prev) => [item, ...prev]);

  const dismissSummary = (idx: number) =>
    setSummaries((prev) => prev.filter((_, i) => i !== idx));

  const handle = async (files: FileList | File[]) => {
    setImporting(true);
    for (const f of Array.from(files)) {
      try {
        const result = await importFile(
          f.name,
          await f.text(),
          src !== "auto" ? { forced: src } : {},
        );
        addSummary({ filename: f.name, result });
      } catch (err) {
        addSummary({
          filename: f.name,
          result: {
            added: 0,
            updated: 0,
            skipped: { duplicate: 0, inFile: 0, removed: 0 },
            errors: [err instanceof Error ? err.message : String(err)],
          },
        });
      }
    }
    setImporting(false);
  };

  const samples = async () => {
    setImporting(true);
    const pairs: [string, string, string][] = [
      ["viaduct-journeys.csv",    SAMPLE_VIADUCT,  "viaduct"],
      ["setlistfm-attended.json", SAMPLE_SETLIST,  "setlistfm"],
      ["stays-cleaned.csv",       SAMPLE_GENERIC,  "generic"],
      ["life-events.csv",         SAMPLE_LIFE,     "generic"],
    ];
    for (const [filename, text, forced] of pairs) {
      try {
        const result = await importFile(filename, text, { forced });
        addSummary({ filename, result });
      } catch (err) {
        addSummary({
          filename,
          result: {
            added: 0,
            updated: 0,
            skipped: { duplicate: 0, inFile: 0, removed: 0 },
            errors: [err instanceof Error ? err.message : String(err)],
          },
        });
      }
    }
    setImporting(false);
  };

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-4xl font-semibold">Import</h1>
      <p className="mb-6 max-w-2xl text-muted-foreground">
        Files are read inside your browser. Records go straight into your journal, flagged for review in the feed. Precedence: your edits &gt; primary records (trains, setlists) &gt; secondary records (bookings, calendars).
      </p>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void handle(e.dataTransfer.files); }}
        className={cn(
          "rounded-md border-2 border-dashed p-8 text-center",
          drag ? "border-primary bg-primary/5" : "border-border",
        )}
      >
        <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-2">{importing ? "Importing..." : "Drop CSV or JSON exports here"}</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <select
            value={src}
            onChange={(e) => setSrc(e.target.value)}
            disabled={importing}
            className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="auto">Detect format</option>
            <option value="letterboxd">Letterboxd diary/reviews CSV</option>
            <option value="netflix">Netflix viewing history CSV</option>
            <option value="goodreads">Goodreads library export CSV</option>
            <option value="icalendar">iCalendar (.ics)</option>
            <option value="viaduct">Viaduct rail CSV</option>
            <option value="setlistfm">setlist.fm JSON/CSV</option>
            <option value="generic">Generic / cleaned CSV or JSON</option>
          </select>
          <Button asChild variant="outline" disabled={importing}>
            <label className="cursor-pointer">
              Choose files
              <input
                type="file"
                multiple
                accept=".csv,.json,.txt"
                className="hidden"
                onChange={(e) => e.target.files && void handle(e.target.files)}
              />
            </label>
          </Button>
          <Button variant="secondary" onClick={samples} disabled={importing}>
            Load sample data
          </Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Generic files need a <code className="font-mono">type</code> column: flight, train, road, stay, concert, gathering, birthday, wedding, milestone, memory... plus start, title, venue, city, people, notes, tier.
        </p>
      </div>

      {/* Inline results */}
      {summaries.length > 0 && (
        <div className="mt-8 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Results</h2>
            <button
              className="text-xs text-muted-foreground underline"
              onClick={() => setSummaries([])}
            >
              Clear all
            </button>
          </div>
          {summaries.map((item, i) => (
            <ResultCard key={i} item={item} onDismiss={() => dismissSummary(i)} />
          ))}
        </div>
      )}
    </div>
  );
}
