import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { allEntries, putMany, removeMany, useJournal, storeFor } from "@/lib/journal/db";
import { EntryCard } from "@/components/journal/EntryCard";
import { AddTripDialog } from "@/components/journal/AddTripDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { entryTitle, type Entry, type Trip } from "@/lib/journal/types";

const day = (e: Entry) => e.start.slice(0, 10);

export const Route = createFileRoute("/trips")({
  head: () => ({
    meta: [
      { title: "Trips — Journal" },
      { name: "description", content: "Every journey in your journal with legs, stays, events and stats." },
      { property: "og:title", content: "Trips — Journal" },
      { property: "og:description", content: "Journeys grouped from your flights, trains, stays and events." },
    ],
  }),
  component: Trips,
});

function TripCard({ trip }: { trip: Trip }) {
  const s = useJournal();
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState("");

  const entries = allEntries(s);
  const members = entries.filter((e) => e.tripId === trip.id).sort((a, b) => a.start.localeCompare(b.start));
  const unassigned = entries.filter((e) => !e.tripId).sort((a, b) => a.start.localeCompare(b.start));
  const inWindow = unassigned.filter((e) => day(e) >= trip.start && day(e) <= trip.end);
  const nights = Math.max(0, Math.round((+new Date(trip.end) - +new Date(trip.start)) / 86400000));
  const legs = members.filter((e) => e.kind === "leg");

  const attach = async (list: Entry[]) => {
    for (const e of list) await putMany(storeFor(e), [{ ...e, tripId: trip.id }]);
  };

  const gather = async () => {
    if (!inWindow.length) {
      toast.info("No unassigned entries fall inside these dates.");
      return;
    }
    await attach(inWindow);
    toast.success(`Added ${inWindow.length} ${inWindow.length === 1 ? "entry" : "entries"} to this trip.`);
  };

  return (
    <article className="rounded-md border border-border bg-card">
      <div className="flex items-start gap-3 p-5">
        <button onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left">
          <p className="font-mono text-xs text-muted-foreground">{trip.start} → {trip.end} · {nights} nights</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-2">
            <h2 className="text-2xl">{trip.title}</h2>
            {trip.purpose && <Badge variant="secondary" className="capitalize">{trip.purpose}</Badge>}
          </div>
          <div className="mt-3 flex gap-4 font-mono text-xs">
            <span>{legs.filter((l) => l.kind === "leg" && l.mode === "air").length} flights</span>
            <span>{legs.filter((l) => l.kind === "leg" && l.mode === "rail").length} trains</span>
            <span>{members.filter((e) => e.kind === "stay").length} stays</span>
            <span>{members.filter((e) => e.kind === "event").length} events</span>
          </div>
        </button>
        <AddTripDialog trip={trip} />
      </div>
      {open && (
        <div className="space-y-4 border-t border-border p-5">
          {trip.notes && <p className="whitespace-pre-wrap font-serif text-sm text-muted-foreground">{trip.notes}</p>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={gather}>
              Gather entries in these dates{inWindow.length ? ` (${inWindow.length})` : ""}
            </Button>
            <Button size="sm" variant="outline" onClick={async () => {
              for (const m of members) await putMany(storeFor(m), [{ ...m, tripId: undefined }]);
              await removeMany("trips", [trip.id]);
              toast.success("Trip dissolved. Its entries stay in your chronicle.");
            }}>Dissolve trip</Button>
          </div>

          <div className="flex gap-2">
            <select
              className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
            >
              <option value="">Attach an existing entry…</option>
              {unassigned.map((e) => (
                <option key={e.id} value={e.id}>{day(e)} · {entryTitle(e)}</option>
              ))}
            </select>
            <Button size="sm" variant="outline" disabled={!pick} onClick={async () => {
              const e = unassigned.find((x) => x.id === pick);
              if (!e) return;
              await attach([e]);
              setPick("");
            }}>Attach</Button>
          </div>

          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="space-y-1">
                <EntryCard entry={m} />
                <button
                  className="text-xs text-muted-foreground underline"
                  onClick={() => putMany(storeFor(m), [{ ...m, tripId: undefined }])}
                >
                  Remove from trip
                </button>
              </div>
            ))}
            {!members.length && <p className="text-sm text-muted-foreground">Nothing attached to this trip yet.</p>}
          </div>
        </div>
      )}
    </article>
  );
}

function Trips() {
  const s = useJournal();
  const trips = [...s.trips].sort((a, b) => b.start.localeCompare(a.start));
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-4xl font-semibold">Trips</h1>
          <p className="mb-6 text-muted-foreground">Journeys you've made or confirmed from imports. Unassigned entries still live in the Chronicle.</p>
        </div>
        <AddTripDialog />
      </div>
      {s.ready && !trips.length && (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
          No trips yet. Create one above, or <Link to="/import" className="text-primary underline">import travel data</Link> and accept suggested trips.
        </p>
      )}
      <div className="space-y-4">{trips.map((t) => <TripCard key={t.id} trip={t} />)}</div>
    </div>
  );
}
