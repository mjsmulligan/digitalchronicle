import { useState, useRef, useEffect } from "react";
import { SourceIcon } from "@/components/journal/SourceIcon";
import { Plane, TrainFront, Car, Music, BedDouble, Users, PartyPopper, Flag, Sparkles, Activity, Clapperboard, Tv, BookOpen, MapPin, ChevronDown, Trash2, X, Plus, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { putMany, removeMany, storeFor, useJournal } from "@/lib/journal/db";
import { CATEGORY_LABEL, entryTitle, view, uid, type Entry, type Leg, type EventCategory, type Person } from "@/lib/journal/types";
import { sourceLabel } from "@/lib/journal/connectors/registry";
import { operatorMarkId } from "@/lib/journal/connectors/icons";
import { StarRating } from "@/components/journal/StarRating";
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
  if (e.kind === "place") return MapPin;
  return CAT_ICON[e.category ?? "activity"];
}
export function entryColor(e: Entry) {
  if (e.kind === "leg") return e.mode === "air" ? "text-air" : e.mode === "rail" ? "text-rail" : "text-road";
  if (e.kind === "stay") return "text-stay";
  if (e.kind === "film" || e.kind === "episode" || e.kind === "book") return "text-muted-foreground";
  if (e.kind === "place") return "text-muted-foreground";
  return e.category === "milestone" ? "text-primary" : "text-gig";
}
export function entryLabel(e: Entry) {
  if (e.kind === "leg") return e.mode === "air" ? "Flight" : e.mode === "rail" ? "Train" : "Road";
  if (e.kind === "stay") return "Stay";
  if (e.kind === "film") return e.rewatch ? "Rewatch" : "Film";
  if (e.kind === "episode") return "Episode";
  if (e.kind === "book") return e.series ? "Series" : "Book";
  if (e.kind === "place") return "Place";
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
  place: ["locality", "region", "country", "start", "end"],
};

// ---------------------------------------------------------------------------
// Participant picker
// ---------------------------------------------------------------------------

function normName(s: string) {
  return s.trim().toLowerCase();
}

function personMatchesQuery(p: Person, q: string): boolean {
  const lq = normName(q);
  if (normName(p.name).includes(lq)) return true;
  return p.aliases?.some((a) => normName(a).includes(lq)) ?? false;
}

interface ParticipantPickerProps {
  /** Current value — mirrors entry.participants */
  participants: string[] | undefined;
  onChange: (next: string[] | undefined) => void;
  people: Person[];
}

function ParticipantPicker({ participants, onChange, people }: ParticipantPickerProps) {
  const self = people.find((p) => p.isSelf);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropRef = useRef<HTMLDivElement>(null);

  // Effective chip list: if participants is undefined, show self implicitly
  const chipIds: string[] =
    participants === undefined
      ? self ? [self.id] : []
      : participants;

  const chips = chipIds.map((id) => people.find((p) => p.id === id)).filter(Boolean) as Person[];

  // Typeahead suggestions: people not already in chipIds
  const suggestions = query.trim()
    ? people.filter((p) => !chipIds.includes(p.id) && personMatchesQuery(p, query))
    : [];

  // Show "Create [name]" option when query doesn't exactly match any suggestion
  const showCreate =
    query.trim().length > 0 &&
    !suggestions.some((p) => normName(p.name) === normName(query));

  function remove(id: string) {
    if (participants === undefined) {
      // Self was implicit — removing it makes the list explicit without self
      if (self && id === self.id) { onChange([]); return; }
      // Removing other when self was implicit: shouldn't happen, but handle gracefully
      onChange([]);
      return;
    }
    const next = participants.filter((pid) => pid !== id);
    onChange(next.length === 0 ? [] : next);
  }

  function add(person: Person) {
    const base = participants === undefined ? (self ? [self.id] : []) : [...participants];
    if (!base.includes(person.id)) onChange([...base, person.id]);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  }

  async function createAndAdd() {
    const name = query.trim();
    if (!name) return;
    const person: Person = { id: uid(), name, createdAt: new Date().toISOString() };
    await putMany("people", [person]);
    add(person);
  }

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const hasSelf = self != null;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">People</p>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((p) => (
          <span
            key={p.id}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
              p.isSelf
                ? "bg-primary/10 text-primary"
                : "bg-muted text-muted-foreground",
            )}
          >
            {p.name}
            {p.isSelf && <span className="font-mono text-[9px] opacity-60">you</span>}
            <button
              type="button"
              aria-label={`Remove ${p.name}`}
              onClick={() => remove(p.id)}
              className="ml-0.5 rounded-full opacity-60 hover:opacity-100"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {chips.length === 0 && (
          <span className="text-xs text-muted-foreground italic">No participants</span>
        )}
        {/* Re-add self button when self was explicitly removed */}
        {hasSelf && self && participants !== undefined && !chipIds.includes(self.id) && (
          <button
            type="button"
            onClick={() => onChange([self.id, ...(participants ?? [])])}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2.5 py-0.5 text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            <Plus className="h-3 w-3" /> add yourself
          </button>
        )}
      </div>

      {/* Typeahead */}
      <div className="relative" ref={dropRef}>
        <Input
          ref={inputRef}
          placeholder="Add person…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { if (query) setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === "Escape") { setOpen(false); setQuery(""); }
            if (e.key === "Enter" && showCreate && !suggestions.length) { e.preventDefault(); void createAndAdd(); }
          }}
          className="h-7 text-sm"
        />
        {open && (suggestions.length > 0 || showCreate) && (
          <div className="absolute z-50 mt-1 w-full rounded-md border border-border bg-popover shadow-md">
            {suggestions.map((p) => (
              <button
                key={p.id}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                onMouseDown={(e) => { e.preventDefault(); add(p); }}
              >
                <span>{p.name}</span>
                {p.aliases?.length ? (
                  <span className="text-xs text-muted-foreground">{p.aliases.join(", ")}</span>
                ) : null}
              </button>
            ))}
            {showCreate && (
              <button
                type="button"
                className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-sm text-muted-foreground hover:bg-accent"
                onMouseDown={(e) => { e.preventDefault(); void createAndAdd(); }}
              >
                <Plus className="h-3.5 w-3.5" />
                Create &ldquo;{query.trim()}&rdquo;
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function EntryCard({ entry, compact }: { entry: Entry; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [reflection, setReflection] = useState(entry.reflection ?? "");
  const [dateStarted, setDateStarted] = useState(entry.kind === "book" ? (entry.dateStarted ?? "") : "");
  const [ov, setOv] = useState<Record<string, string>>(entry.overrides ?? {});
  const [participants, setParticipants] = useState<string[] | undefined>(entry.participants);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { trips, people } = useJournal();
  const v = view(entry);
  const Icon = entryIcon(v);
  const trip = trips.find((t) => t.id === entry.tripId);

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const clean = Object.fromEntries(Object.entries(ov).filter(([, x]) => x.trim()));
      const extra = entry.kind === "book" ? { dateStarted: dateStarted || undefined } : {};
      await putMany(storeFor(entry), [{ ...entry, ...extra, reflection: reflection || undefined, overrides: Object.keys(clean).length ? clean : undefined, participants }]);
      toast.success("Entry saved");
    } catch (err) {
      toast.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await removeMany(storeFor(entry), [entry.id]);
    } catch (err) {
      toast.error(`Could not delete: ${err instanceof Error ? err.message : String(err)}`);
    }
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
              : v.kind === "place"
                ? [v.region, v.country].filter(Boolean).join(", ")
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
            {"rating" in entry && <StarRating rating={entry.rating} className="self-center" />}
            {entry.overrides && <Badge variant="outline" className="h-4 px-1 text-[10px]">edited</Badge>}
            {trip && <Badge variant="secondary" className="h-4 px-1 text-[10px]">{trip.title}</Badge>}
          </div>
          {!compact && meta && <p className="truncate text-sm text-muted-foreground">{meta}</p>}
          {!open && entry.reflection && <p className="mt-1 line-clamp-1 font-serif text-sm italic text-foreground/80">&ldquo;{entry.reflection}&rdquo;</p>}
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
            <summary className="cursor-pointer py-2 text-muted-foreground">Manual corrections (always win over imported data)</summary>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {OVERRIDE_FIELDS[entry.kind].map((f) => (
                <label key={f} className="text-xs text-muted-foreground">
                  {f}
                  <Input value={ov[f] ?? ""} placeholder={String((entry as unknown as Record<string, unknown>)[f] ?? "")} onChange={(e) => setOv({ ...ov, [f]: e.target.value })} />
                </label>
              ))}
            </div>
          </details>
          {entry.kind !== "film" && entry.kind !== "episode" && entry.kind !== "book" && (
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
          )}
          {entry.kind === "book" && entry.series && (
            <p className="text-xs text-muted-foreground">
              Series: <span className="font-medium">{entry.series}{entry.seriesNumber !== undefined ? ` #${entry.seriesNumber}` : ""}</span>
            </p>
          )}
          {entry.kind === "book" && (
            <label className="block text-xs text-muted-foreground">
              Started reading
              <Input type="date" value={dateStarted} onChange={(e) => setDateStarted(e.target.value)} className="mt-1" />
            </label>
          )}
          {people.length > 0 && (
            <ParticipantPicker
              participants={participants}
              onChange={setParticipants}
              people={people}
            />
          )}
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            <SourceIcon source={entry.kind === "leg" ? (operatorMarkId((entry as Leg).operator) ?? entry.source) : entry.source} />
            {sourceLabel(entry.source)} · t{entry.tier}
          </span>
            <div className="flex items-center gap-2">
              {confirmDelete ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3.5 w-3.5" />Delete?</span>
                  <Button size="sm" variant="destructive" onClick={handleDelete}>Yes, delete</Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                </div>
              ) : (
                <>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 className="h-4 w-4" /></Button>
                  <Button size="sm" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
