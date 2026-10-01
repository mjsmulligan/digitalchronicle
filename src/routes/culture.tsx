import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useJournal } from "@/lib/journal/db";
import { EntryCard } from "@/components/journal/EntryCard";
import { StarRating } from "@/components/journal/StarRating";
import { AddEntryDialog } from "@/components/journal/AddEntryDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { day, view, type Film, type Episode, type Book, type JEvent, type Entry } from "@/lib/journal/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/culture")({
  head: () => ({
    meta: [
      { title: "Culture — Journal" },
      { name: "description", content: "Films, TV, books and concerts from your journal." },
    ],
  }),
  component: Culture,
});

type CultureKind = "film" | "episode" | "book" | "concert";
type Filter = "all" | CultureKind | "rewatch";

type CultureEntry = Film | Episode | Book | JEvent;

function isCulture(e: Entry): e is CultureEntry {
  return e.kind === "film" || e.kind === "episode" || e.kind === "book" ||
    (e.kind === "event" && (e as JEvent).category === "concert");
}

function sortDate(e: CultureEntry): string {
  return (e.overrides?.start ?? e.start) || "0000";
}

function avgRating(entries: CultureEntry[]): number | null {
  const rated = entries.filter((e) => e.rating !== undefined);
  if (!rated.length) return null;
  return rated.reduce((sum, e) => sum + e.rating!, 0) / rated.length;
}

// ── Books: series grouping ──────────────────────────────────────────────────

interface SeriesGroup {
  name: string;
  books: Book[];
}

function groupBooksBySeries(books: Book[]): { standalone: Book[]; series: SeriesGroup[] } {
  const seriesMap = new Map<string, Book[]>();
  const standalone: Book[] = [];
  for (const b of books) {
    if (b.series) {
      const arr = seriesMap.get(b.series) ?? [];
      arr.push(b);
      seriesMap.set(b.series, arr);
    } else {
      standalone.push(b);
    }
  }
  const series: SeriesGroup[] = [...seriesMap.entries()]
    .map(([name, bks]) => ({
      name,
      books: [...bks].sort((a, b) => (a.seriesNumber ?? 999) - (b.seriesNumber ?? 999)),
    }))
    .sort((a, b) => sortDate(b.books[0]) .localeCompare(sortDate(a.books[0])));
  return { standalone, series };
}

// ── Episodes: show grouping ─────────────────────────────────────────────────

interface ShowGroup {
  showTitle: string;
  episodes: Episode[];
  latestDate: string;
}

function groupEpisodesByShow(episodes: Episode[]): ShowGroup[] {
  const map = new Map<string, Episode[]>();
  for (const ep of episodes) {
    const arr = map.get(ep.showTitle) ?? [];
    arr.push(ep);
    map.set(ep.showTitle, arr);
  }
  return [...map.entries()]
    .map(([showTitle, eps]) => {
      const sorted = [...eps].sort((a, b) => sortDate(b).localeCompare(sortDate(a)));
      return { showTitle, episodes: sorted, latestDate: sortDate(sorted[0]) };
    })
    .sort((a, b) => b.latestDate.localeCompare(a.latestDate));
}

// ── Main component ──────────────────────────────────────────────────────────

function Culture() {
  const s = useJournal();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const concerts = useMemo(
    () => s.events.filter((e) => e.category === "concert"),
    [s.events],
  );

  const allCulture = useMemo(
    () =>
      ([...s.films, ...s.episodes, ...s.books, ...concerts] as CultureEntry[]).sort((a, b) =>
        sortDate(b).localeCompare(sortDate(a)),
      ),
    [s.films, s.episodes, s.books, concerts],
  );

  // Search-only filtered list (not kind-filtered) — used for pill counts
  const searchFiltered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return allCulture;
    return allCulture.filter((e) => {
      const v = view(e);
      const hay = [
        v.kind === "film" ? v.title
          : v.kind === "episode" ? `${v.showTitle} ${v.episodeTitle ?? ""}`
          : v.kind === "event" ? `${(v as JEvent).artist} ${(v as JEvent).venue} ${(v as JEvent).city}`
          : `${(v as Book).title} ${(v as Book).author}`,
        v.kind === "film" ? (v.director ?? "") : v.kind === "book" ? ((v as Book).series ?? "") : "",
        v.reflection ?? "",
      ].join(" ").toLowerCase();
      return hay.includes(ql);
    });
  }, [allCulture, q]);

  const counts = useMemo(
    () => ({
      all: searchFiltered.length,
      film: searchFiltered.filter((e) => e.kind === "film").length,
      rewatch: searchFiltered.filter((e) => e.kind === "film" && (e as Film).rewatch).length,
      episode: searchFiltered.filter((e) => e.kind === "episode").length,
      book: searchFiltered.filter((e) => e.kind === "book").length,
      concert: searchFiltered.filter((e) => e.kind === "event" && (e as JEvent).category === "concert").length,
    }),
    [searchFiltered],
  );

  const filtered = useMemo(() => {
    return searchFiltered.filter((e) => {
      if (filter === "rewatch" && !(e.kind === "film" && (e as Film).rewatch)) return false;
      if (filter === "concert" && !(e.kind === "event" && (e as JEvent).category === "concert")) return false;
      if (filter !== "all" && filter !== "rewatch" && filter !== "concert" && e.kind !== filter) return false;
      return true;
    });
  }, [searchFiltered, filter]);

  const avg = useMemo(() => avgRating(filtered), [filtered]);
  const ratedCount = filtered.filter((e) => e.rating !== undefined).length;
  const uniqueTitles = useMemo(() => {
    const titles = new Set(
      filtered.map((e) =>
        e.kind === "film" ? e.title
          : e.kind === "episode" ? e.showTitle
          : e.kind === "event" ? (e as JEvent).artist
          : (e as Book).title,
      ),
    );
    return titles.size;
  }, [filtered]);

  const isEmpty = s.ready && allCulture.length === 0;

  // ── Render helpers ────────────────────────────────────────────────────────

  const pills: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "Everything", count: counts.all },
    { key: "film", label: "Films", count: counts.film },
    { key: "rewatch", label: "Rewatches", count: counts.rewatch },
    { key: "episode", label: "TV", count: counts.episode },
    { key: "book", label: "Books", count: counts.book },
    { key: "concert", label: "Concerts", count: counts.concert },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold tracking-tight">Culture</h1>
          <p className="text-muted-foreground">
            {filtered.length !== allCulture.length
              ? `${filtered.length} of ${allCulture.length}`
              : allCulture.length}{" "}
            {allCulture.length === 1 ? "entry" : "entries"}
            {uniqueTitles !== filtered.length && ` · ${uniqueTitles} titles`}
            {ratedCount > 0 && avg !== null && (
              <>
                {" "}· <StarRating rating={Math.round(avg * 2) / 2} className="inline-flex" /> avg
              </>
            )}
          </p>
        </div>
        <AddEntryDialog />
      </header>

      <div className="mb-6 space-y-2">
        <div className="flex flex-wrap gap-1">
          {pills.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={cn(
                "rounded-full border border-border px-3 py-1.5 text-sm",
                filter === key ? "bg-foreground text-background" : "hover:bg-accent",
              )}
            >
              {label} <span className="font-mono text-xs">{count}</span>
            </button>
          ))}
        </div>
        <Input
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8 w-full sm:w-40"
        />
      </div>

      {isEmpty && (
        <div className="rounded-md border border-dashed border-border p-10 text-center">
          <h2 className="text-2xl">Nothing logged yet</h2>
          <p className="mt-2 text-muted-foreground">
            Import a Letterboxd, Netflix, Goodreads, or Setlist.fm export to populate your culture log.
          </p>
          <Button asChild className="mt-4">
            <Link to="/import">Import data</Link>
          </Button>
        </div>
      )}

      {s.ready && allCulture.length > 0 && filtered.length === 0 && (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
          Nothing matches that filter.
        </p>
      )}

      {/* Concerts view */}
      {(filter === "all" || filter === "concert") &&
        filtered.filter((e) => e.kind === "event").length > 0 && (
          <ConcertsSection
            concerts={filtered.filter((e) => e.kind === "event") as JEvent[]}
            showHeading={filter === "all"}
          />
        )}

      {/* Films view */}
      {(filter === "all" || filter === "film" || filter === "rewatch") &&
        filtered.filter((e) => e.kind === "film").length > 0 && (
          <FilmsSection
            films={filtered.filter((e) => e.kind === "film") as Film[]}
            showHeading={filter === "all"}
          />
        )}

      {/* TV / Episodes view */}
      {(filter === "all" || filter === "episode") &&
        filtered.filter((e) => e.kind === "episode").length > 0 && (
          <EpisodesSection
            episodes={filtered.filter((e) => e.kind === "episode") as Episode[]}
            showHeading={filter === "all"}
          />
        )}

      {/* Books view */}
      {(filter === "all" || filter === "book") &&
        filtered.filter((e) => e.kind === "book").length > 0 && (
          <BooksSection
            books={filtered.filter((e) => e.kind === "book") as Book[]}
            showHeading={filter === "all"}
          />
        )}
    </div>
  );
}

// ── Concerts section ──────────────────────────────────────────────────────────

function ConcertsSection({ concerts, showHeading }: { concerts: JEvent[]; showHeading: boolean }) {
  const byYear = useMemo(() => {
    const map = new Map<string, JEvent[]>();
    for (const c of concerts) {
      const yr = day(c.overrides?.start ?? c.start).slice(0, 4);
      const arr = map.get(yr) ?? [];
      arr.push(c);
      map.set(yr, arr);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [concerts]);

  return (
    <section className="mb-10">
      {showHeading && (
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Concerts · {concerts.length}
        </h2>
      )}
      <div className="space-y-8">
        {byYear.map(([year, list]) => (
          <div key={year}>
            {!showHeading && (
              <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                {year} · {list.length}
              </h3>
            )}
            {showHeading && (
              <p className="mb-2 font-mono text-xs text-muted-foreground">{year} · {list.length}</p>
            )}
            <div className="space-y-2">
              {list.map((c) => (
                <EntryCard key={c.id} entry={c} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Films section ─────────────────────────────────────────────────────────────

function FilmsSection({ films, showHeading }: { films: Film[]; showHeading: boolean }) {
  const byYear = useMemo(() => {
    const map = new Map<string, Film[]>();
    for (const f of films) {
      const yr = day(f.overrides?.start ?? f.start).slice(0, 4);
      const arr = map.get(yr) ?? [];
      arr.push(f);
      map.set(yr, arr);
    }
    return [...map.entries()].sort(([a], [b]) => b.localeCompare(a));
  }, [films]);

  return (
    <section className="mb-10">
      {showHeading && (
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Films · {films.length}
        </h2>
      )}
      <div className="space-y-8">
        {byYear.map(([year, list]) => (
          <div key={year}>
            {!showHeading && (
              <h3 className="mb-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                {year} · {list.length}
              </h3>
            )}
            {showHeading && (
              <p className="mb-2 font-mono text-xs text-muted-foreground">{year} · {list.length}</p>
            )}
            <div className="space-y-2">
              {list.map((f) => (
                <EntryCard key={f.id} entry={f} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Episodes section ──────────────────────────────────────────────────────────

function EpisodesSection({ episodes, showHeading }: { episodes: Episode[]; showHeading: boolean }) {
  const shows = useMemo(() => groupEpisodesByShow(episodes), [episodes]);

  return (
    <section className="mb-10">
      {showHeading && (
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          TV · {episodes.length} episodes · {shows.length} shows
        </h2>
      )}
      <div className="space-y-6">
        {shows.map(({ showTitle, episodes: eps }) => (
          <div key={showTitle}>
            <h3 className="mb-2 flex items-center gap-2">
              <span className="font-medium">{showTitle}</span>
              <span className="font-mono text-xs text-muted-foreground">{eps.length} ep</span>
            </h3>
            <div className="space-y-2">
              {eps.map((ep) => (
                <EntryCard key={ep.id} entry={ep} compact />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Books section ─────────────────────────────────────────────────────────────

function BooksSection({ books, showHeading }: { books: Book[]; showHeading: boolean }) {
  const { standalone, series } = useMemo(() => groupBooksBySeries(books), [books]);

  // Interleave series and standalone sorted by most-recent entry date
  const sections = useMemo(() => {
    type Section =
      | { type: "series"; data: SeriesGroup; date: string }
      | { type: "standalone"; data: Book; date: string };

    const all: Section[] = [
      ...series.map((sg) => ({
        type: "series" as const,
        data: sg,
        date: sortDate(sg.books[0]),
      })),
      ...standalone.map((b) => ({
        type: "standalone" as const,
        data: b,
        date: sortDate(b),
      })),
    ];
    return all.sort((a, b) => b.date.localeCompare(a.date));
  }, [standalone, series]);

  return (
    <section className="mb-10">
      {showHeading && (
        <h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Books · {books.length}
        </h2>
      )}
      <div className="space-y-6">
        {sections.map((sec) => {
          if (sec.type === "series") {
            const sg = sec.data as SeriesGroup;
            const seriesAvg = avgRating(sg.books);
            return (
              <div key={`series:${sg.name}`}>
                <h3 className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-medium">{sg.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {sg.books.length} {sg.books.length === 1 ? "book" : "books"} read
                  </span>
                  {seriesAvg !== null && (
                    <StarRating rating={Math.round(seriesAvg * 2) / 2} />
                  )}
                </h3>
                <div className="space-y-2">
                  {sg.books.map((b) => (
                    <EntryCard key={b.id} entry={b} compact />
                  ))}
                </div>
              </div>
            );
          }
          const b = sec.data as Book;
          return <EntryCard key={b.id} entry={b} />;
        })}
      </div>
    </section>
  );
}
