import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { putMany, useJournal } from "@/lib/journal/db";
import { CATEGORY_LABEL, uid, type EventCategory, type Entry, type Purpose } from "@/lib/journal/types";
import { eventKey, legKey, stayKey } from "@/lib/journal/connectors/keys";
import { loadStations, timezoneFor } from "@/lib/journal/geo";
import { localToUTC } from "@/lib/journal/tz";

type Kind = EventCategory | "stay" | "flight" | "train" | "road";
const KINDS: Kind[] = ["memory", "concert", "gathering", "celebration", "milestone", "activity", "flight", "train", "road", "stay"];
const PURPOSES: Purpose[] = ["work", "family", "leisure", "other"];

export function AddEntryDialog({ defaultDate, tripId }: { defaultDate?: string; tripId?: string }) {
  const { trips } = useJournal();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("memory");
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const date = f.date || defaultDate || new Date().toISOString().slice(0, 10);

  const save = async () => {
    if (f.city || f.from || f.to) await loadStations();
    // Manual entries are the user's own statement: highest confidence, and never guessed at.
    const companions = f.people ? f.people.split(",").map((x) => x.trim()).filter(Boolean) : undefined;
    const purpose = (f.purpose as Purpose) || undefined;
    const base = {
      id: uid(), source: "manual" as const, tier: 1 as const, confidence: "confirmed" as const,
      start: f.time ? `${date}T${f.time}` : date, createdAt: new Date().toISOString(),
      journal: f.journal || undefined, purpose, companions,
      tripId: (f.tripId || tripId) || undefined,
    };
    let e: Entry;
    if (kind === "stay") {
      const tz = timezoneFor(f.city || "");
      e = {
        ...base, kind: "stay", place: f.title || "Stay", city: f.city, end: f.end || undefined,
        startTz: tz, endTz: tz, startUTC: localToUTC(base.start, tz), dedupeKey: "",
      };
    } else if (kind === "flight" || kind === "train" || kind === "road") {
      const tz = timezoneFor(f.from || "");
      e = {
        ...base, kind: "leg", mode: kind === "flight" ? "air" : kind === "train" ? "rail" : "road",
        from: f.from || "?", to: f.to || "?", startTz: tz, endTz: timezoneFor(f.to || ""),
        startUTC: localToUTC(base.start, tz), dedupeKey: "",
      };
    } else {
      const tz = timezoneFor(f.city || "");
      e = {
        ...base, kind: "event", category: kind, artist: f.title || CATEGORY_LABEL[kind],
        venue: f.venue || "", city: f.city || "", people: companions,
        startTz: tz, startUTC: localToUTC(base.start, tz), dedupeKey: "",
      };
    }
    e.dedupeKey = e.kind === "leg" ? legKey(e) : e.kind === "stay" ? stayKey(e) : eventKey(e);
    await putMany(e.kind === "leg" ? "legs" : e.kind === "stay" ? "stays" : "events", [e]);
    setF({});
    setOpen(false);
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await save();
    } catch (error) {
      toast.error(`Could not save entry: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  const isLeg = kind === "flight" || kind === "train" || kind === "road";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4" /> Add entry</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New journal entry</DialogTitle></DialogHeader>
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <Button key={k} size="sm" variant={k === kind ? "default" : "outline"} onClick={() => setKind(k)} className="capitalize">{k}</Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input type="date" value={date} onChange={set("date")} />
          <Input type="time" value={f.time ?? ""} onChange={set("time")} />
          <select
            className="col-span-2 h-9 rounded-md border border-input bg-background px-3 text-sm capitalize"
            value={f.purpose ?? ""}
            onChange={(e) => setF({ ...f, purpose: e.target.value })}
          >
            <option value="">Purpose (optional)</option>
            {PURPOSES.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
          </select>
          {isLeg ? (
            <>
              <Input placeholder="From (e.g. LHR)" value={f.from ?? ""} onChange={set("from")} />
              <Input placeholder="To (e.g. BER)" value={f.to ?? ""} onChange={set("to")} />
            </>
          ) : (
            <>
              <Input className="col-span-2" placeholder={kind === "concert" ? "Artist" : kind === "stay" ? "Place" : "Title"} value={f.title ?? ""} onChange={set("title")} />
              {kind !== "stay" && <Input placeholder="Venue / place" value={f.venue ?? ""} onChange={set("venue")} />}
              <Input placeholder="City" value={f.city ?? ""} onChange={set("city")} />
              {kind === "stay" && <Input type="date" value={f.end ?? ""} onChange={set("end")} />}
            </>
          )}
          <Input className="col-span-2" placeholder="Companions (comma separated)" value={f.people ?? ""} onChange={set("people")} />
          {!tripId && (
            <select
              className="col-span-2 h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={f.tripId ?? ""}
              onChange={(e) => setF({ ...f, tripId: e.target.value })}
            >
              <option value="">No trip</option>
              {[...trips].sort((a, b) => b.start.localeCompare(a.start)).map((t) => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          )}
        </div>
        <Textarea placeholder="Reflection…" className="font-serif" value={f.journal ?? ""} onChange={set("journal")} />
        <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save entry"}</Button>
      </DialogContent>
    </Dialog>
  );
}
