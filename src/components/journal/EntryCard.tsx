import { useState } from "react";
import { Plane, TrainFront, Car, Music, BedDouble, Users, PartyPopper, Flag, Sparkles, Activity, Clapperboard, Tv, BookOpen, ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { putMany, removeMany, storeFor, useJournal } from "@/lib/journal/db";
import { CATEGORY_LABEL, entryTitle, view, type Entry, type EventCategory } from "@/lib/journal/types";
import { sourceLabel } from "@/lib/journal/connectors/registry";
import { cn } from "@/lib/utils";

const CAT_ICON: Record<EventCategory, typeof Music> = {
  concert: Music, gathering: Users, celebration: PartyPopper, milestone: Flag, memory: Sparkles, activity: Activity,
};

export function entryIcon(e: Entry) {
  if (e.kind === "leg") return e.mode === "air" ? Plane : e.mode === "rail" ? TrainFront : Car;
  if (e.kind === "stay") return BedDouble;
  if (e.kind === "film") return Clapperboard;
  if (e.kind === "episode") return Tv;
  if (e.kind === "book") return BookOpen;
  return CAT_ICON[e.category ?? "activity"];
}
export function entryColor(e: Entry) {
  if (e.kind === "leg") return e.mode === "air" ? "text-air" : e.mode === "rail" ? "text-rail" : "text-road";
  if (e.kind === "stay") return "text-stay";
  if (e.kind === "film" || e.kind === "episode" || e.kind === "book") return "text-muted-foreground";
  return e.category === "milestone" ? "text-primary" : "text-gig";
}
export function entryLabel(e: Entry) {
  if (e.kind === "leg") return e.mode === "air" ? "Flight" : e.mode === "rail" ? "Train" : "Road";
  if (e.kind === "stay") return "Stay";
  if (e.kind === "film") return e.rewatch ? "Rewatch" : "Film";
  if (e.kind === "episode") return "Episode";
  if (e.kind === "book") return e.series ? "Series" : "Book";
  return CATEGORY_LABEL[e.category ?? "activity"];
}

const time = (s?: string) => (s && s.includes("T") ? s.slice(11, 16) : "");

const OVERRIDE_FIELDS: Record<Entry["kind"], string[]> = {
  leg: ["from", "to", "start", "end", "flightNumber", "operator"],
  stay: ["place", "city", "start", "end"],
  event: ["artist", "venue", "city", "start"],
  film: ["title", "year", "director", "start"],
  episode: ["showTitle", "season", "episodeTitle", "start"],
  book: ["title", "author", "year", "series", "start"],
};

export function EntryCard({ entry, compact }: { entry: Entry; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reflection, setReflection] = useState(entry.reflection ?? "");
  const [ov, setOv] = useState<Record<string, string>>(entry.overrides ?? {});
  const { trips } = useJournal();
  const v = view(entry);
  const Icon = entryIcon(v);
  const trip = trips.find((t) => t.id === entry.tripId);

  const save = async () => {
    const clean = Object.fromEntries(Object.entries(ov).filter(([, x]) => x.trim()));
    await putMany(storeFor(entry), [{ ...entry, reflection: reflection || undefined, overrides: Object.keys(clean).length ? clean : undefined }]);
  };

  const setTrip = async (tripId: string) => {
    await putMany(storeFor(entry), [{ ...entry, tripId: tripId || undefined }]);
  };

  const meta =
    v.kind === "leg"
      ? [v.flightNumber || v.trainNumber, v.operator, v.aircraft, v.seat && `seat ${v.seat}`].filter(Boolean).join(" · ")
      : v.kind === "stay"
        ? [v.city, v.end && `until ${v.end.slice(0, 10)}`].filter(Boolean).join(" · ")
        : v.kind === "film"
          ? [v.director, v.year && String(v.year)].filter(Boolean).join(" · ")
          : v.kind === "episode"
            ? [v.season, v.episodeNumber && `Ep ${v.episodeNumber}`].filter(Boolean).join(" · ")
            : v.kind === "book"
              ? [v.series && `${v.series}${v.seriesNumber ? ` #${v.seriesNumber}` : ""}`, v.year && String(v.year)].filter(Boolean).join(" · ")
              : [v.category === "concert" ? v.venue : v.venue, v.city, v.people?.join(", ")].filter(Boolean).join(" · ");

  return (
    <div className="rounded-md border border-border bg-card">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 p-3 text-left">
        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", entryColor(v))} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="font-medium">{entryTitle(entry)}</span>
            {v.kind === "leg" && (time(v.start) || time(v.end)) && (
              <span className="font-mono text-xs text-muted-foreground">{time(v.start)}–{time(v.end)}</span>
            )}
            {entry.overrides && <Badge variant="outline" className="h-4 px-1 text-[10px]">edited</Badge>}
            {trip && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{trip.title}</Badge>}
          </div>
          {!compact && meta && <p className="truncate text-sm text-muted-foreground">{meta}</p>}
          {!open && entry.reflection && <p className=”mt-1 line-clamp-1 font-serif text-sm italic text-foreground/80”>”{entry.reflection}”</p>}
        </div>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{entryLabel(v)}</span>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {v.kind === "event" && v.setlist && (
            <ol className="list-decimal pl-5 text-sm">
              {v.setlist.map((s, i) => <li key={i}>{s}</li>)}
            </ol>
          )}
          <Textarea value={reflection} onChange={(e) => setReflection(e.target.value)} placeholder="Write a reflection…" className="font-serif" />
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Manual corrections (always win over imported data)</summary>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {OVERRIDE_FIELDS[entry.kind].map((f) => (
                <label key={f} className="text-xs text-muted-foreground">
                  {f}
                  <Input value={ov[f] ?? ""} placeholder={String((entry as unknown as Record<string, unknown>)[f] ?? "")} onChange={(e) => setOv({ ...ov, [f]: e.target.value })} />
                </label>
              ))}
            </div>
          </details>
          <label className="block text-xs text-muted-foreground">
            Trip
            <select
              className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={entry.tripId ?? ""}
              onChange={(e) => setTrip(e.target.value)}
            >
              <option value="">No trip</option>
              {[...trips].sort((a, b) => b.start.localeCompare(a.start)).map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-muted-foreground">source: {sourceLabel(entry.source)} · tier {entry.tier}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => removeMany(storeFor(entry), [entry.id])}><Trash2 className="h-4 w-4" /></Button>
              <Button size="sm" onClick={save}>Save</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
