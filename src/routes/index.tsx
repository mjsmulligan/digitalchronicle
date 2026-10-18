import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { allEntries, putMany, markReviewed, storeFor, useJournal } from "@/lib/journal/db";
import { EntryCard } from "@/components/journal/EntryCard";
import { AddEntryDialog } from "@/components/journal/AddEntryDialog";
import { PersonFilter } from "@/components/journal/PersonFilter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { day, entryTitle, uid, type Entry, type Note, type Person } from "@/lib/journal/types";
import { cn } from "@/lib/utils";

function entryHasPerson(e: Entry, person: Person): boolean {
  if (person.isSelf) return !e.participants || e.participants.includes(person.id);
  return e.participants?.includes(person.id) ?? false;
}

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chronicle — Journal" },
      { name: "description", content: "Your life in one chronological journal: concerts, gatherings, milestones, trips and daily reflections." },
      { property: "og:title", content: "Chronicle — Journal" },
      { property: "og:description", content: "Concerts, celebrations, milestones, travel and reflections in one private timeline." },
    ],
  }),
  component: Chronicle,
});

const STATIC_FILTERS = [
  { id: "all", label: "Everything" },
  { id: "travel", label: "Travel" },
  { id: "concert", label: "Concerts" },
  { id: "social", label: "Gatherings & celebrations" },
  { id: "milestone", label: "Milestones" },
  { id: "memory", label: "Memories" },
  { id: "notes", label: "Reflections" },
] as const;
type F = (typeof STATIC_FILTERS)[number]["id"] | "new";

function matches(e: Entry, f: F) {
  if (f === "all") return true;
  if (f === "new") return e.unreviewed !== undefined;
  if (f === "travel") return e.kind === "leg" || e.kind === "stay";
  if (e.kind !== "event") return false;
  if (f === "social") return e.category === "gathering" || e.category === "celebration";
  if (f === "memory") return e.category === "memory" || e.category === "activity";
  return e.category === f;
}

function DayNote({ date, note }: { date: string; note?: Note }) {
  const [text, setText] = useState(note?.text ?? "");
  const [editing, setEditing] = useState(false);
  if (!editing)
    return note ? (
      <p onClick={() => setEditing(true)} className="cursor-text whitespace-pre-wrap border-l-2 border-primary pl-3 font-serif text-[15px] italic">{note.text}</p>
    ) : (
      <button onClick={() => setEditing(true)} className="block min-h-[44px] text-xs text-muted-foreground hover:text-foreground">+ reflection for this day</button>
    );
  return (
    <div className="space-y-2">
      <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} className="font-serif" placeholder="How was the day?" />
      <Button size="sm" onClick={async () => {
        const t = new Date().toISOString();
        await putMany("notes", [{ id: note?.id ?? uid(), date, text, createdAt: note?.createdAt ?? t, updatedAt: t }]);
        setEditing(false);
      }}>Save reflection</Button>
    </div>
  );
}

function Chronicle() {
  const s = useJournal();
  const [filter, setFilter] = useState<F>("all");
  const [q, setQ] = useState("");
  const [newDay, setNewDay] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [keepingAll, setKeepingAll] = useState(false);

  const activePerson = personId ? s.people.find((p) => p.id === personId) ?? null : null;

  const unreviewedCount = useMemo(
    () => allEntries(s).filter((e) => e.unreviewed !== undefined).length,
    [s],
  );

  const days = useMemo(() => {
    const map = new Map<string, { entries: Entry[]; note?: Note }>();
    const get = (d: string) => map.get(d) ?? (map.set(d, { entries: [] }), map.get(d)!);
    const ql = q.toLowerCase();
    if (filter !== "notes")
      allEntries(s)
        .filter((e) =>
          matches(e, filter) &&
          (!ql || (entryTitle(e) + (e.reflection ?? "")).toLowerCase().includes(ql)) &&
          (!activePerson || entryHasPerson(e, activePerson)),
        )
        .forEach((e) => get(day(e.overrides?.start ?? e.start)).entries.push(e));
    // Only show notes when not filtering by person (notes don't have participants)
    if (!activePerson)
      s.notes.filter((n) => n.date && (!ql || n.text.toLowerCase().includes(ql))).forEach((n) => {
        if (filter === "all" || filter === "notes" || map.has(n.date!)) get(n.date!).note = n;
      });
    if (newDay) get(newDay);
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([d, v]) => ({ d, ...v, entries: v.entries.sort((a, b) => (a.overrides?.start ?? a.start).localeCompare(b.overrides?.start ?? b.start)) }));
  }, [s, filter, q, newDay, activePerson]);

  const tripOf = (d: string) => s.trips.find((t) => d >= t.start && d <= t.end);
  const total = s.legs.length + s.stays.length + s.events.length;

  // Keep all entries currently visible in the New filter
  const handleKeepAll = async () => {
    if (keepingAll) return;
    const toKeep = allEntries(s).filter((e) => e.unreviewed !== undefined);
    if (toKeep.length === 0) return;
    // Group by store to batch the markReviewed calls
    const byStore = new Map<string, string[]>();
    for (const e of toKeep) {
      const store = storeFor(e);
      const ids = byStore.get(store) ?? [];
      ids.push(e.id);
      byStore.set(store, ids);
    }
    setKeepingAll(true);
    try {
      for (const [store, ids] of byStore) {
        await markReviewed(store as Parameters<typeof markReviewed>[0], ids);
      }
    } finally {
      setKeepingAll(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Chronicle</h1>
          <p className="text-muted-foreground">{total} entries · {s.notes.length} reflections · {s.trips.length} trips</p>
        </div>
        <div className="flex gap-2">
          <Input type="date" className="w-40" onChange={(e) => setNewDay(e.target.value)} aria-label="Jump to or write about a day" title="Jump to or write about a day" />
          <AddEntryDialog />
        </div>
      </header>
      <div className="mb-6 space-y-2">
        <div className="flex flex-wrap gap-1">
          {STATIC_FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={cn("rounded-full border border-border px-3 py-1.5 text-sm", filter === f.id ? "bg-foreground text-background" : "hover:bg-accent")}>{f.label}</button>
          ))}
          {unreviewedCount > 0 && (
            <button
              onClick={() => setFilter(filter === "new" ? "all" : "new")}
              className={cn("rounded-full border px-3 py-1.5 text-sm", filter === "new" ? "border-primary bg-primary text-primary-foreground" : "border-primary/50 text-primary hover:bg-primary/10")}
            >
              New {unreviewedCount > 99 ? "99+" : unreviewedCount}
            </button>
          )}
        </div>
        <PersonFilter people={s.people} value={personId} onChange={setPersonId} />
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-full sm:w-40" />
      </div>

      {/* Keep all bar — shown when New filter is active */}
      {filter === "new" && unreviewedCount > 0 && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-primary/30 bg-primary/5 px-4 py-2">
          <span className="text-sm text-foreground/80">{unreviewedCount} {unreviewedCount === 1 ? "entry" : "entries"} to review</span>
          <Button size="sm" variant="outline" onClick={handleKeepAll} disabled={keepingAll}>
            {keepingAll ? "Keeping…" : `Keep all ${unreviewedCount}`}
          </Button>
        </div>
      )}

      {s.ready && total === 0 && s.notes.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-6 text-center md:p-10">
          <h2 className="text-2xl">Your journal is empty</h2>
          <p className="mt-2 text-muted-foreground">Add an entry, or import concert, flight, rail and life-event exports.</p>
          <Button asChild className="mt-4"><Link to="/import">Import data or load samples</Link></Button>
        </div>
      )}

      <ol className="space-y-8">
        {days.map(({ d, entries, note }) => {
          const trip = tripOf(d);
          const date = new Date(d + "T00:00");
          return (
            <li key={d} className="grid grid-cols-[4.5rem_1fr] gap-4">
              <div className="text-right">
                <div className="font-serif text-3xl leading-none">{date.getDate()}</div>
                <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {date.toLocaleDateString("en-GB", { weekday: "short" })}<br />{date.toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
                </div>
              </div>
              <div className="space-y-2 border-l border-border pl-4">
                {trip && <Link to="/trips" className="font-mono text-[10px] uppercase tracking-wider text-primary">✦ {trip.title}</Link>}
                {entries.map((e) => <EntryCard key={e.id + (e.overrides ? JSON.stringify(e.overrides) : "")} entry={e} />)}
                <DayNote key={note?.id ?? d} date={d} note={note} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
