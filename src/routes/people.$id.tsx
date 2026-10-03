import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { ArrowLeft } from "lucide-react";
import { useJournal } from "@/lib/journal/db";
import { EntryCard } from "@/components/journal/EntryCard";
import { day, type Entry } from "@/lib/journal/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/people/$id")({
  head: () => ({
    meta: [{ title: "Person — Journal" }],
  }),
  component: PersonTimeline,
});

type FilterKind = "all" | "trips" | "culture" | "moments";
const FILTER_LABELS: Record<FilterKind, string> = {
  all: "All",
  trips: "Trips",
  culture: "Culture",
  moments: "Moments",
};

function entryMatchesFilter(e: Entry, f: FilterKind): boolean {
  if (f === "all") return true;
  if (f === "trips") return e.kind === "leg" || e.kind === "stay";
  if (f === "culture") return e.kind === "film" || e.kind === "episode" || e.kind === "book";
  if (f === "moments") return e.kind === "event";
  return true;
}

function PersonTimeline() {
  const { id } = Route.useParams();
  const { people, legs, stays, events, films, episodes, books } = useJournal();
  const [filter, setFilter] = useState<FilterKind>("all");

  const person = people.find((p) => p.id === id);
  if (!person) throw notFound();

  useEffect(() => {
    document.title = `${person.name} — Journal`;
    return () => { document.title = "Journal — a private chronicle of your life"; };
  }, [person.name]);

  const allEntries: Entry[] = [...legs, ...stays, ...events, ...films, ...episodes, ...books];

  // Entries this person was part of
  const personEntries = allEntries.filter((e) => {
    if (person.isSelf) {
      // Self is implicit on entries where participants is absent
      return !e.participants || e.participants.includes(person.id);
    }
    return e.participants?.includes(person.id) ?? false;
  });

  const filtered = personEntries
    .filter((e) => entryMatchesFilter(e, filter))
    .sort((a, b) => {
      const da = a.overrides?.start ?? a.start;
      const db = b.overrides?.start ?? b.start;
      return db.localeCompare(da);
    });

  // Group by year
  const byYear = new Map<string, Entry[]>();
  for (const e of filtered) {
    const yr = (e.overrides?.start ?? e.start).slice(0, 4) || "Unknown";
    if (!byYear.has(yr)) byYear.set(yr, []);
    byYear.get(yr)!.push(e);
  }
  const years = [...byYear.keys()].sort((a, b) => b.localeCompare(a));

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      {/* Back link */}
      <Link
        to="/people"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        People
      </Link>

      {/* Header */}
      <header>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary">
            {person.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <h1 className="font-serif text-3xl font-semibold">{person.name}</h1>
            {person.aliases?.length ? (
              <p className="text-sm text-muted-foreground">
                also known as {person.aliases.join(", ")}
              </p>
            ) : null}
            {person.isSelf && (
              <p className="text-xs font-mono uppercase tracking-wider text-primary/70">you</p>
            )}
          </div>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          {personEntries.length} {personEntries.length === 1 ? "entry" : "entries"} total
        </p>
      </header>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {(Object.keys(FILTER_LABELS) as FilterKind[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            {FILTER_LABELS[f]}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">
          No {filter === "all" ? "" : filter + " "}entries yet.
        </p>
      ) : (
        <div className="space-y-10">
          {years.map((yr) => (
            <section key={yr}>
              <h2 className="mb-3 font-mono text-sm font-medium text-muted-foreground">{yr}</h2>
              <div className="space-y-2">
                {byYear.get(yr)!.map((e) => (
                  <div key={e.id}>
                    <p className="mb-1 font-mono text-[11px] text-muted-foreground">
                      {day(e.overrides?.start ?? e.start)}
                    </p>
                    <EntryCard entry={e} />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
