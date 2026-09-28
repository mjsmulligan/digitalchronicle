import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { allEntries, putMany, removeMany, useJournal, storeFor } from "@/lib/journal/db";
import { EntryCard } from "@/components/journal/EntryCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Trip } from "@/lib/journal/types";

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
  const [t, setT] = useState(trip);
  const members = allEntries(s).filter((e) => e.tripId === trip.id).sort((a, b) => a.start.localeCompare(b.start));
  const nights = Math.max(0, Math.round((+new Date(trip.end) - +new Date(trip.start)) / 86400000));
  const legs = members.filter((e) => e.kind === "leg");
  return (
    <article className="rounded-md border border-border bg-card">
      <button onClick={() => setOpen(!open)} className="w-full p-5 text-left">
        <p className="font-mono text-xs text-muted-foreground">{trip.start} → {trip.end} · {nights} nights</p>
        <h2 className="mt-1 text-2xl">{trip.title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{trip.destinations.join(" · ")}</p>
        <div className="mt-3 flex gap-4 font-mono text-xs">
          <span>{legs.filter((l) => l.kind === "leg" && l.mode === "air").length} flights</span>
          <span>{legs.filter((l) => l.kind === "leg" && l.mode === "rail").length} trains</span>
          <span>{members.filter((e) => e.kind === "stay").length} stays</span>
          <span>{members.filter((e) => e.kind === "event").length} events</span>
        </div>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-5">
          <Input value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} />
          <Textarea value={t.notes} onChange={(e) => setT({ ...t, notes: e.target.value })} placeholder="Trip reflections…" className="font-serif" />
          <div className="flex gap-2">
            <Button size="sm" onClick={() => putMany("trips", [t])}>Save</Button>
            <Button size="sm" variant="outline" onClick={async () => {
              for (const m of members) await putMany(storeFor(m), [{ ...m, tripId: undefined }]);
              await removeMany("trips", [trip.id]);
            }}>Dissolve trip</Button>
          </div>
          <div className="space-y-2">{members.map((m) => <EntryCard key={m.id} entry={m} />)}</div>
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
      <h1 className="text-4xl font-semibold">Trips</h1>
      <p className="mb-6 text-muted-foreground">Journeys confirmed from your imports. Unassigned entries still live in the Chronicle.</p>
      {s.ready && !trips.length && (
        <p className="rounded-md border border-dashed border-border p-8 text-center text-muted-foreground">
          No trips yet. <Link to="/import" className="text-primary underline">Import travel data</Link> and accept suggested trips.
        </p>
      )}
      <div className="space-y-4">{trips.map((t) => <TripCard key={t.id} trip={t} />)}</div>
    </div>
  );
}
