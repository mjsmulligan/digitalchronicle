import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useJournal } from "@/lib/journal/db";
import { EntryCard } from "@/components/journal/EntryCard";
import { AddEntryDialog } from "@/components/journal/AddEntryDialog";
import { PersonFilter } from "@/components/journal/PersonFilter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { day, type Entry, type EventCategory, type JEvent, type Person } from "@/lib/journal/types";
import { cn } from "@/lib/utils";

function entryHasPerson(e: Entry, person: Person): boolean {
  if (person.isSelf) return !e.participants || e.participants.includes(person.id);
  return e.participants?.includes(person.id) ?? false;
}

export const Route = createFileRoute("/moments")({
  head: () => ({
    meta: [
      { title: "Moments — Journal" },
      { name: "description", content: "Gatherings, celebrations, milestones and everyday moments from your journal." },
      { property: "og:title", content: "Moments — Journal" },
      { property: "og:description", content: "Every gathering, party, celebration and milestone in one private list." },
    ],
  }),
  component: Moments,
});

// Concerts live in Culture, not here
const CATEGORIES: EventCategory[] = ["gathering", "celebration", "milestone", "memory", "activity"];
const CATEGORY_PLURAL: Record<EventCategory, string> = {
  concert: "Concerts", gathering: "Gatherings", celebration: "Celebrations",
  milestone: "Milestones", memory: "Memories", activity: "Activities",
};

function field(e: JEvent, key: "artist" | "venue" | "city") {
  return e.overrides?.[key] ?? e[key] ?? "";
}

function Moments() {
  const s = useJournal();
  const [cat, setCat] = useState<EventCategory | "all">("all");
  const [q, setQ] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);

  const moments = useMemo(
    () =>
      [...s.events]
        .filter((e) => e.category !== "concert")
        .sort((a, b) => (b.overrides?.start ?? b.start).localeCompare(a.overrides?.start ?? a.start)),
    [s.events],
  );

  const counts = useMemo(() => {
    const m = {} as Record<EventCategory, number>;
    for (const c of CATEGORIES) m[c] = 0;
    for (const e of moments) m[e.category] = (m[e.category] ?? 0) + 1;
    return m;
  }, [moments]);

  const activePerson = personId ? s.people.find((p) => p.id === personId) ?? null : null;

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return moments.filter((e) => {
      if (cat !== "all" && e.category !== cat) return false;
      if (ql) {
        const hay = [field(e, "artist"), field(e, "venue"), field(e, "city"), e.tour ?? "", (e.people ?? []).join(" "), (e.companions ?? []).join(" "), e.reflection ?? ""].join(" ").toLowerCase();
        if (!hay.includes(ql)) return false;
      }
      if (activePerson && !entryHasPerson(e, activePerson)) return false;
      return true;
    });
  }, [moments, cat, q, activePerson]);

  const groups = useMemo(() => {
    const map = new Map<string, JEvent[]>();
    for (const e of shown) {
      const year = day(e.overrides?.start ?? e.start).slice(0, 4);
      const arr = map.get(year) ?? [];
      arr.push(e);
      map.set(year, arr);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [shown]);

  const venues = new Set(shown.map((e) => field(e, "venue")).filter(Boolean)).size;
  const cities = new Set(shown.map((e) => field(e, "city")).filter(Boolean)).size;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Moments</h1>
          <p className="text-muted-foreground">
            {shown.length} {shown.length === 1 ? "moment" : "moments"}
            {venues > 0 && ` · ${venues} venues`}
            {cities > 0 && ` · ${cities} cities`}
          </p>
        </div>
        <AddEntryDialog />
      </header>

      <div className="mb-6 space-y-2">
        <div className="flex flex-wrap gap-1">
          <button
            onClick={() => setCat("all")}
            className={cn("rounded-full border border-border px-3 py-1.5 text-sm", cat === "all" ? "bg-foreground text-background" : "hover:bg-accent")}
          >
            Everything <span className="font-mono text-xs">{moments.length}</span>
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={cn("rounded-full border border-border px-3 py-1.5 text-sm", cat === c ? "bg-foreground text-background" : "hover:bg-accent")}
            >
              {CATEGORY_PLURAL[c]} <span className="font-mono text-xs">{counts[c] ?? 0}</span>
            </button>
          ))}
        </div>
        <PersonFilter people={s.people} value={personId} onChange={setPersonId} />
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="h-8 w-full sm:w-40" />
      </div>

      {s.ready && moments.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-10 text-center">
          <h2 className="text-2xl">No moments yet</h2>
          <p className="mt-2 text-muted-foreground">
            Record a gathering, celebration, milestone or memory using the add button above.
          </p>
          <Button asChild className="mt-4"><Link to="/import">Import data</Link></Button>
        </div>
      )}

      {s.ready && moments.length > 0 && shown.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">Nothing matches that filter.</p>
      )}

      <div className="space-y-8">
        {groups.map(([year, list]) => (
          <section key={year}>
            <h2 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">{year} · {list.length}</h2>
            <div className="space-y-2">
              {list.map((e) => <EntryCard key={e.id + (e.overrides ? JSON.stringify(e.overrides) : "")} entry={e} />)}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
