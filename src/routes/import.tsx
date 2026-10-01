import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Upload, AlertTriangle, Scissors, Merge, Trash2 } from "lucide-react";
import { useJournal, removeMany } from "@/lib/journal/db";
import { stageFile, saveBatch, commitBatch } from "@/lib/journal/staging";
import { SAMPLE_VIADUCT, SAMPLE_SETLIST, SAMPLE_GENERIC, SAMPLE_LIFE } from "@/lib/journal/samples";
import { entryTitle, uid, type Source, type StagingBatch, type StageStatus } from "@/lib/journal/types";
import { sourceLabel } from "@/lib/journal/connectors/registry";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { entryIcon, entryColor, entryLabel } from "@/components/journal/EntryCard";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/import")({
  head: () => ({
    meta: [
      { title: "Import & staging — Journal" },
      { name: "description", content: "Import Viaduct, setlist.fm and custom CSV/JSON exports, review, then commit to your journal." },
      { property: "og:title", content: "Import & staging — Journal" },
      { property: "og:description", content: "Review parsed records, duplicates and suggested trips before they enter your journal." },
    ],
  }),
  component: ImportPage,
});

type Auto = Exclude<Source, "manual"> | "auto";
const STATUS: Record<StageStatus, { label: string; cls: string }> = {
  new: { label: "new", cls: "bg-rail/15 text-rail" },
  supersedes: { label: "replaces lower-tier", cls: "bg-air/15 text-air" },
  duplicate: { label: "already in journal", cls: "bg-muted text-muted-foreground" },
  superseded: { label: "journal has higher tier", cls: "bg-muted text-muted-foreground" },
  "batch-duplicate": { label: "duplicate in file", cls: "bg-destructive/10 text-destructive" },
};

function BatchReview({ batch }: { batch: StagingBatch }) {
  const [b, setB] = useState(batch);
  const update = (n: StagingBatch) => { setB(n); void saveBatch(n); };
  const selected = b.records.filter((r) => r.selected).length;
  const setRecords = (recs: StagingBatch["records"]) => update({ ...b, records: recs });

  return (
    <section className="rounded-md border border-border bg-card">
      <header className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="flex-1">
          <h2 className="text-xl">{b.filename}</h2>
          <p className="font-mono text-xs text-muted-foreground">{sourceLabel(b.source)} · {b.records.length} parsed · {b.errors.length} errors · {selected} selected</p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => removeMany("staging", [b.id])}><Trash2 className="h-4 w-4" /> Discard</Button>
        <Button size="sm" disabled={!selected} onClick={async () => {
          const r = await commitBatch(b);
          toast.success(`Added ${r.count} entries to your journal`);
        }}>Commit {selected} to journal</Button>
      </header>

      {b.errors.length > 0 && (
        <div className="border-b border-border bg-destructive/5 p-3 text-sm text-destructive">
          {b.errors.slice(0, 5).map((e, i) => <div key={i}>{e}</div>)}
          {b.errors.length > 5 && <div>…and {b.errors.length - 5} more</div>}
        </div>
      )}

      <div>
        <div className="p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Records</h3>
            <div className="flex gap-2 text-xs">
              <button className="underline" onClick={() => setRecords(b.records.map((r) => ({ ...r, selected: r.status === "new" || r.status === "supersedes" })))}>select importable</button>
              <button className="underline" onClick={() => setRecords(b.records.map((r) => ({ ...r, selected: false })))}>none</button>
            </div>
          </div>
          <ul className="divide-y divide-border">
            {b.records.map((r, i) => {
              const Icon = entryIcon(r.entry);
              const disabled = r.status === "duplicate" || r.status === "superseded" || r.status === "batch-duplicate";
              return (
                <li key={r.entry.id} className={cn("flex gap-3 py-2", disabled && "opacity-60")}>
                  <Checkbox checked={r.selected} disabled={disabled} onCheckedChange={(v) => {
                    const recs = [...b.records]; recs[i] = { ...r, selected: !!v }; setRecords(recs);
                  }} />
                  <Icon className={cn("mt-0.5 h-4 w-4", entryColor(r.entry))} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono text-xs text-muted-foreground">{r.entry.start.replace("T", " ")}</span>
                      <span className="font-medium">{entryTitle(r.entry)}</span>
                      <span className="text-xs text-muted-foreground">{entryLabel(r.entry)}</span>
                      <span className={cn("rounded px-1.5 text-[10px]", STATUS[r.status].cls)}>{STATUS[r.status].label}</span>
                    </div>
                    {r.warnings.map((w) => (
                      <p key={w} className="flex items-center gap-1 text-xs text-road"><AlertTriangle className="h-3 w-3" />{w}</p>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

      </div>
    </section>
  );
}

function ImportPage() {
  const s = useJournal();
  const [src, setSrc] = useState<Auto>("auto");
  const [drag, setDrag] = useState(false);

  const handle = async (files: FileList | File[]) => {
    for (const f of Array.from(files)) {
      try {
        const b = await stageFile(f.name, await f.text(), src === "auto" ? undefined : src);
        toast(`Staged ${b.records.length} records from ${f.name} (${sourceLabel(b.source)})`);
      } catch (err) {
        toast.error(`Could not import ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  const samples = async () => {
    await stageFile("viaduct-journeys.csv", SAMPLE_VIADUCT, "viaduct");
    await stageFile("setlistfm-attended.json", SAMPLE_SETLIST, "setlistfm");
    await stageFile("stays-cleaned.csv", SAMPLE_GENERIC, "generic");
    await stageFile("life-events.csv", SAMPLE_LIFE, "generic");
    toast.success("Sample exports staged — review them below");
  };

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-4xl font-semibold">Import & staging</h1>
      <p className="mb-6 max-w-2xl text-muted-foreground">
        Files are read inside your browser. Nothing enters your journal until you commit. Precedence: your manual edits &gt; primary records (trains, setlists) &gt; secondary records (bookings, calendars).
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void handle(e.dataTransfer.files); }}
        className={cn("rounded-md border-2 border-dashed p-8 text-center", drag ? "border-primary bg-primary/5" : "border-border")}
      >
        <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-2">Drop CSV or JSON exports here</p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <select value={src} onChange={(e) => setSrc(e.target.value as Auto)} className="h-9 w-full max-w-xs rounded-md border border-input bg-background px-2 text-sm">
            <option value="auto">Detect format</option>
            <option value="letterboxd">Letterboxd diary/reviews CSV</option>
            <option value="netflix">Netflix viewing history CSV</option>
            <option value="goodreads">Goodreads library export CSV</option>
            <option value="icalendar">iCalendar (.ics)</option>
            <option value="viaduct">Viaduct rail CSV</option>
            <option value="setlistfm">setlist.fm JSON/CSV</option>
            <option value="generic">Generic / cleaned CSV or JSON</option>
          </select>
          <Button asChild variant="outline"><label className="cursor-pointer">Choose files<input type="file" multiple accept=".csv,.json,.txt" className="hidden" onChange={(e) => e.target.files && handle(e.target.files)} /></label></Button>
          <Button variant="secondary" onClick={samples}>Load sample data</Button>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          Generic files need a <code className="font-mono">type</code> column: flight, train, road, stay, concert, gathering, birthday, wedding, milestone, memory… plus start, title, venue, city, people, notes, tier.
        </p>
      </div>

      <div className="mt-8 space-y-6">
        {s.staging.length > 0 && <h2 className="flex items-center gap-2 text-2xl">Staging queue <Badge variant="secondary">{s.staging.length}</Badge></h2>}
        {[...s.staging].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((b) => <BatchReview key={b.id} batch={b} />)}
      </div>
    </div>
  );
}
