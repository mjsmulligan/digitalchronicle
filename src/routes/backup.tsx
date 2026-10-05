import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { clearAll, replaceAll, useJournal } from "@/lib/journal/db";
import { STORES, type JournalData } from "@/lib/journal/types";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/backup")({
  head: () => ({
    meta: [
      { title: "Backup & data — Journal" },
      { name: "description", content: "Export your whole journal to JSON, restore it in one click, or reset local storage." },
      { property: "og:title", content: "Backup & data — Journal" },
      { property: "og:description", content: "Your journal stays portable: full JSON export and restore." },
    ],
  }),
  component: Backup,
});

const fmt = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${(n / 1e3).toFixed(1)} KB`);

function Backup() {
  const s = useJournal();
  const [est, setEst] = useState<{ usage?: number; quota?: number }>({});
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { navigator.storage?.estimate?.().then(setEst); }, [s]);
  const data: JournalData = { trips: s.trips, legs: s.legs, stays: s.stays, events: s.events, films: s.films, episodes: s.episodes, books: s.books, series: s.series, notes: s.notes, staging: s.staging, people: s.people, places: s.places, placeEvents: s.placeEvents ?? [] };
  const size = new Blob([JSON.stringify(data)]).size;

  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ app: "journal", version: 1, exportedAt: new Date().toISOString(), data }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `journal-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const restore = async (file: File) => {
    try {
      const j = JSON.parse(await file.text());
      const d = j.data ?? j;
      if (!STORES.some((k) => Array.isArray(d[k]))) throw new Error("Not a Journal backup");
      const clean = Object.fromEntries(STORES.map((k) => [k, Array.isArray(d[k]) ? d[k] : []])) as unknown as JournalData;
      await replaceAll(clean);
      toast.success("Journal restored from backup");
    } catch (e) {
      toast.error(`Restore failed: ${(e as Error).message}`);
    }
  };

  const handleFileSelect = (file: File) => {
    setPendingFile(file);
    setRestoreOpen(true);
    // Reset the input so the same file can be re-selected if needed
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-4xl font-semibold">Backup & data</h1>
      <p className="mb-6 text-muted-foreground">Everything lives in this browser only — no accounts, no cloud. Export regularly to keep your journal safe.</p>

      <div className="grid grid-cols-2 gap-3 xs:grid-cols-3 sm:grid-cols-6">
        {STORES.map((k) => (
          <div key={k} className="rounded-md border border-border bg-card p-3">
            <div className="font-serif text-2xl">{(s[k] as unknown[]).length}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{k === "legs" ? "journeys" : k}</div>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-xs text-muted-foreground">
        Journal data {fmt(size)}{est.usage != null && ` · browser usage ${fmt(est.usage)} of ${fmt(est.quota ?? 0)}`}
      </p>

      <div className="mt-8 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-card p-4">
          <div className="min-w-0 flex-1"><h2 className="text-lg">Export everything</h2><p className="text-sm text-muted-foreground">One JSON file with every entry, trip, reflection and staged import.</p></div>
          <Button onClick={exportJSON}>Download backup</Button>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-border bg-card p-4">
          <div className="min-w-0 flex-1"><h2 className="text-lg">Restore from backup</h2><p className="text-sm text-muted-foreground">Replaces the current journal with the file's contents.</p></div>
          <Button asChild variant="outline">
            <label className="cursor-pointer">
              Choose file
              <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && handleFileSelect(e.target.files[0])} />
            </label>
          </Button>
        </div>

        {/* Restore confirmation dialog */}
        <AlertDialog open={restoreOpen} onOpenChange={setRestoreOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Replace your journal with this backup?</AlertDialogTitle>
              <AlertDialogDescription>
                {pendingFile?.name && <><strong>{pendingFile.name}</strong> will replace everything currently in your journal. This can't be undone — export a backup first if you want to keep what's here.</>}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setPendingFile(null)}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={async () => {
                if (pendingFile) await restore(pendingFile);
                setPendingFile(null);
              }}>Restore</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <div className="flex flex-wrap items-start justify-between gap-3 rounded-md border border-destructive/40 bg-card p-4">
          <div className="min-w-0 flex-1"><h2 className="text-lg">Reset journal</h2><p className="text-sm text-muted-foreground">Permanently deletes all local data in this browser.</p></div>
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="destructive">Reset</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Erase your whole journal?</AlertDialogTitle>
                <AlertDialogDescription>This can't be undone. Download a backup first if you might want it back.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={async () => { await clearAll(); toast("Journal erased"); }}>Erase everything</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
