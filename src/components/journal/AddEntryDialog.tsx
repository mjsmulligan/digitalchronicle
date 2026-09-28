import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { putMany } from "@/lib/journal/db";
import { CATEGORY_LABEL, uid, type EventCategory, type Entry } from "@/lib/journal/types";
import { eventKey, legKey, stayKey } from "@/lib/journal/parsers";

type Kind = EventCategory | "stay" | "flight" | "train" | "road";
const KINDS: Kind[] = ["memory", "concert", "gathering", "celebration", "milestone", "activity", "flight", "train", "road", "stay"];

export function AddEntryDialog({ defaultDate }: { defaultDate?: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Kind>("memory");
  const [f, setF] = useState<Record<string, string>>({});
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const date = f.date || defaultDate || new Date().toISOString().slice(0, 10);

  const submit = async () => {
    const base = { id: uid(), source: "manual" as const, tier: 1 as const, start: f.time ? `${date}T${f.time}` : date, createdAt: new Date().toISOString(), journal: f.journal || undefined };
    let e: Entry;
    if (kind === "stay") e = { ...base, kind: "stay", place: f.title || "Stay", city: f.city, end: f.end || undefined, dedupeKey: "" };
    else if (kind === "flight" || kind === "train" || kind === "road")
      e = { ...base, kind: "leg", mode: kind === "flight" ? "air" : kind === "train" ? "rail" : "road", from: f.from || "?", to: f.to || "?", dedupeKey: "" };
    else e = { ...base, kind: "event", category: kind, artist: f.title || CATEGORY_LABEL[kind], venue: f.venue || "", city: f.city || "", people: f.people ? f.people.split(",").map((x) => x.trim()) : undefined, dedupeKey: "" };
    e.dedupeKey = e.kind === "leg" ? legKey(e) : e.kind === "stay" ? stayKey(e) : eventKey(e);
    await putMany(e.kind === "leg" ? "legs" : e.kind === "stay" ? "stays" : "events", [e]);
    setF({});
    setOpen(false);
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
              {kind !== "stay" && <Input className="col-span-2" placeholder="People (comma separated)" value={f.people ?? ""} onChange={set("people")} />}
            </>
          )}
        </div>
        <Textarea placeholder="Reflection…" className="font-serif" value={f.journal ?? ""} onChange={set("journal")} />
        <Button onClick={submit}>Save entry</Button>
      </DialogContent>
    </Dialog>
  );
}
