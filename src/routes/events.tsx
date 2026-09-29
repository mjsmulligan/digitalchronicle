import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useJournal } from "@/lib/journal/db";
import { EntryCard } from "@/components/journal/EntryCard";
import { AddEntryDialog } from "@/components/journal/AddEntryDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CATEGORY_LABEL, day, type EventCategory, type JEvent } from "@/lib/journal/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/events")({
  head: () => ({
    meta: [
      { title: "Events — Journal" },
      { name: "description", content: "Concerts, gatherings, celebrations, milestones and everyday moments from your journal." },
      { property: "og:title", content: "Events — Journal" },
      { property: "og:description", content: "Every concert, party, celebration and milestone in one private list." },
    ],
  }),
  component: Events,
});

const CATEGORIES: EventCategory[] = ["concert", "gathering", "celebration", "milestone", "memory", "activity"];
const CATEGORY_PLURAL: Record<EventCategory, string> = {
  concert: "Concerts", gathering: "Gatherings", celebration: "Celebrations",
  milestone: "Milestones", memory: "Memories", activity: "Activities",
};

function field(e: JEvent, key: "artist" | "venue" | "city") {
  return e.overrides?.[key] ?? e[key] ?? "";
}

function Events() {
  const s = useJournal();
  const [cat, setCat] = useState<EventCategory | "all">("all");
  const [q, setQ] = useState("");

  const events = useMemo(
    () => [...s.events].sort((a, b) => (b.overrides?.start ?? b.start).localeCompare(a.overrides?.start ?? a.start)),
    [s.events],
  );

  const counts = useMemo(() => {
    const m = {} as Record<EventCategory, number>;
    for (const c of CATEGORIES) m[c] = 0;
    for (const e of events) m[e.category] = (m[e.category] ?? 0) + 1;
    return m;
  }, [events]);

  const shown = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return events.filter((e) => {
      if (cat !== "all" && e.category !== cat) return false;
      if (!ql) return true;
      const hay = [field(e, "artist"), field(e, "venue"), field(e, "city"), e.tour ?? "", (e.people ?? []).join(" "), (e.companions ?? []).join(" "), e.journal ?? ""].join(" ").toLowerCase();
      return hay.includes(ql);
    });
  }, [events, cat, q]);

  const groups = useMemo(() => {
    const map = new Map<string, JEvent[]>();
    for (const e of shown) {
      const year = day(e.overrides?.start ?? e.start).slice(0, 4);
      const arr = map.get(year) ?? [];
      arr.push(e);
      map.set(year, arr);
    }
    return [...map.entries()];
  }, [shown]);

  const venues = new Set(shown.map((e) => field(e, "venue")).filter(Boolean)).size;
  const cities = new Set(shown.map((e) => field(e, "city")).filter(Boolean)).size;

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Events</h1>
          <p className="text-muted-foreground">
            {shown.length} {shown.length === 1 ? "moment" : "moments"} · {venues} venues · {cities} cities
          </p>
        </div>
        <AddEntryDialog />
      </header>

      <div className="mb-6 flex flex-wrap gap-1">
        <button
          onClick={() => setCat("all")}
          className={cn("rounded-full border border-border px-3 py-1 text-sm", cat === "all" ? "bg-foreground text-background" : "hover:bg-accent")}
        >
          Everything <span className="font-mono text-xs">{events.length}</span>
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={cn("rounded-full border border-border px-3 py-1 text-sm", cat === c ? "bg-foreground text-background" : "hover:bg-accent")}
          >
            {CATEGORY_PLURAL[c]} <span className="font-mono text-xs">{counts[c] ?? 0}</span>
          </button>
        ))}
        <Input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} className="ml-auto h-8 w-40" />
      </div>

      {s.ready && events.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-10 text-center">
          <h2 className="text-2xl">No events yet</h2>
          <p className="mt-2 text-muted-foreground">Add a concert, party or milestone by hand, or import a setlist.fm export.</p>
          <Button asChild className="mt-4"><Link to="/import">Import data or load samples</Link></Button>
        </div>
      )}

      {s.ready && events.length > 0 && shown.length === 0 && (
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
