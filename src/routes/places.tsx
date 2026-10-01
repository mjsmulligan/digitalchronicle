import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { allEntries, putMany, removeMany, useJournal } from "@/lib/journal/db";
import { normKey, type PlaceInfo } from "@/lib/journal/geo";
import { uid, view, type PlaceRecord } from "@/lib/journal/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/places")({
  head: () => ({
    meta: [
      { title: "Places — Journal" },
      { name: "description", content: "A map and list of every place in your journal." },
      { property: "og:title", content: "Places — Journal" },
      { property: "og:description", content: "Where your life has happened: cities, venues, stations and airports." },
    ],
  }),
  component: Places,
});

const W = 1000, H = 500;
const px = (lon: number, lat: number) => [((lon + 180) / 360) * W, ((90 - lat) / 180) * H] as const;

// ─── Resolve dialog ───────────────────────────────────────────────────────────

interface ResolveDialogProps {
  code: string;
  existing?: PlaceRecord;
  onClose: () => void;
  onRemove?: () => void;
}

function ResolveDialog({ code, existing, onClose, onRemove }: ResolveDialogProps) {
  const [name, setName] = useState(existing?.name ?? "");
  const [lat, setLat] = useState(existing?.lat != null ? String(existing.lat) : "");
  const [lon, setLon] = useState(existing?.lon != null ? String(existing.lon) : "");
  const [tz, setTz] = useState(existing?.timezone ?? "");
  const [saving, setSaving] = useState(false);

  const valid = name.trim() && lat.trim() && lon.trim() &&
    !isNaN(parseFloat(lat)) && !isNaN(parseFloat(lon));

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const record: PlaceRecord = {
        id: existing?.id ?? uid(),
        code: normKey(code),
        name: name.trim(),
        lat: parseFloat(lat),
        lon: parseFloat(lon),
        timezone: tz.trim() || undefined,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
      };
      await putMany("places", [record]);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <DialogContent className="max-w-sm">
      <DialogHeader>
        <DialogTitle>Resolve place</DialogTitle>
      </DialogHeader>
      <div className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Code / key</label>
          <Input value={code} readOnly className="font-mono text-sm opacity-70" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Display name <span className="text-destructive">*</span></label>
          <Input
            placeholder="e.g. Dublin Airport"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Latitude <span className="text-destructive">*</span></label>
            <Input placeholder="53.4264" value={lat} onChange={(e) => setLat(e.target.value)} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Longitude <span className="text-destructive">*</span></label>
            <Input placeholder="-6.2499" value={lon} onChange={(e) => setLon(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Timezone <span className="text-muted-foreground/60">(optional)</span></label>
          <Input placeholder="Europe/Dublin" value={tz} onChange={(e) => setTz(e.target.value)} />
          <p className="mt-1 text-[11px] text-muted-foreground">IANA zone. Used to display local times correctly.</p>
        </div>
        <div className="flex items-center justify-between pt-1">
          {onRemove ? (
            <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onRemove}>
              Remove place
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={!valid || saving}>
              {saving ? "Saving…" : "Save place"}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function Places() {
  const s = useJournal();
  const [resolving, setResolving] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Build lookup map from user-resolved places
  const placeMap = useMemo(() => {
    const m = new Map<string, PlaceRecord>();
    for (const p of s.places) m.set(p.code, p);
    return m;
  }, [s.places]);

  const lookup = (code: string): PlaceInfo | undefined => {
    const r = placeMap.get(normKey(code));
    if (!r) return undefined;
    return { name: r.name, lat: r.lat, lon: r.lon, timezone: r.timezone ?? "" };
  };

  const { points, arcs, unknown } = useMemo(() => {
    const pts = new Map<string, { name: string; lat: number; lon: number; count: number; kinds: Set<string> }>();
    const arcs: { a: [number, number]; b: [number, number]; mode: string }[] = [];
    const unknown = new Map<string, number>();
    const add = (code: string, kind: string) => {
      if (!code) return;
      const p = lookup(code);
      if (!p) return unknown.set(normKey(code), (unknown.get(normKey(code)) ?? 0) + 1);
      const cur = pts.get(p.name) ?? { ...p, count: 0, kinds: new Set() };
      cur.count++;
      cur.kinds.add(kind);
      pts.set(p.name, cur);
    };
    allEntries(s).map(view).forEach((e) => {
      if (e.kind === "leg") {
        add(e.from, e.mode); add(e.to, e.mode);
        const a = lookup(e.from), b = lookup(e.to);
        if (a && b) arcs.push({ a: [a.lon, a.lat], b: [b.lon, b.lat], mode: e.mode });
      } else if (e.kind === "stay") add(e.city ?? e.place, "stay");
      else if (e.kind === "event") add(e.city, e.category);
    });
    return { points: [...pts.values()].sort((a, b) => b.count - a.count), arcs, unknown: [...unknown.entries()] };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, placeMap]);

  const color = (m: string) => (m === "air" ? "var(--air)" : m === "rail" ? "var(--rail)" : "var(--road)");

  const { ready } = s;
  const editingRecord = editingId ? s.places.find((p) => p.id === editingId) : undefined;
  const deletingRecord = deletingId ? s.places.find((p) => p.id === deletingId) : undefined;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-4xl font-semibold">Places</h1>
      <p className="mb-6 text-muted-foreground">{points.length} mapped places · drawn offline, nothing leaves your browser.</p>

      {ready && points.length === 0 && unknown.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-10 text-center">
          <h2 className="text-2xl">No travel data yet</h2>
          <p className="mt-2 text-muted-foreground">
            Import flights, trains, stays, or events to see where your life has taken you.
          </p>
          <Button asChild className="mt-4">
            <Link to="/import">Import travel data</Link>
          </Button>
        </div>
      )}

      {points.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[600px]">
            {Array.from({ length: 11 }, (_, i) => <line key={"v" + i} x1={i * 100} x2={i * 100} y1={0} y2={H} stroke="var(--border)" strokeWidth={0.5} />)}
            {Array.from({ length: 7 }, (_, i) => <line key={"h" + i} y1={(i * H) / 6} y2={(i * H) / 6} x1={0} x2={W} stroke="var(--border)" strokeWidth={i === 3 ? 1 : 0.5} />)}
            {arcs.map((r, i) => {
              const [x1, y1] = px(...r.a), [x2, y2] = px(...r.b);
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - Math.hypot(x2 - x1, y2 - y1) * 0.2;
              return <path key={i} d={`M${x1},${y1} Q${mx},${my} ${x2},${y2}`} fill="none" stroke={color(r.mode)} strokeWidth={1.2} strokeDasharray={r.mode === "rail" ? "3 2" : undefined} opacity={0.8} />;
            })}
            {points.map((p) => {
              const [x, y] = px(p.lon, p.lat);
              return (
                <g key={p.name}>
                  <circle cx={x} cy={y} r={2 + Math.min(p.count, 8)} fill="var(--primary)" opacity={0.25} />
                  <circle cx={x} cy={y} r={2} fill="var(--primary)" />
                  <title>{p.name} — {p.count}</title>
                </g>
              );
            })}
          </svg>
        </div>
      )}

      <div className="mt-8 grid gap-8 md:grid-cols-[2fr_1fr]">
        {points.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="py-2">Place</th><th>Appearances</th><th>Why</th><th></th></tr>
              </thead>
              <tbody>
                {points.map((p) => {
                  const record = placeMap.get(normKey(p.name)) ??
                    [...placeMap.values()].find((r) => r.name === p.name);
                  return (
                    <tr key={p.name} className="border-t border-border">
                      <td className="py-2 font-medium">{p.name}</td>
                      <td className="font-mono">{p.count}</td>
                      <td className="max-w-[10rem] truncate text-muted-foreground" title={[...p.kinds].join(", ")}>{[...p.kinds].join(", ")}</td>
                      <td className="py-2 pl-2">
                        {record && (
                          <button
                            onClick={() => setEditingId(record.id)}
                            className="text-xs text-muted-foreground hover:text-foreground"
                          >
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {unknown.length > 0 && (
          <div>
            <h2 className="mb-1 text-lg">Unresolved places</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              These codes appear in your journal but haven't been located yet. Click Resolve to add coordinates.
            </p>
            <ul className="space-y-1.5 text-sm">
              {unknown.map(([code, n]) => (
                <li key={code} className="flex items-center justify-between gap-2">
                  <span className="font-mono">{code} <span className="font-sans text-muted-foreground">×{n}</span></span>
                  <Dialog
                    open={resolving === code}
                    onOpenChange={(open) => setResolving(open ? code : null)}
                  >
                    <DialogTrigger asChild>
                      <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
                        Resolve
                      </Button>
                    </DialogTrigger>
                    {resolving === code && (
                      <ResolveDialog
                        code={code}
                        onClose={() => setResolving(null)}
                      />
                    )}
                  </Dialog>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Edit dialog for resolved places */}
      <Dialog
        open={!!editingId}
        onOpenChange={(open) => { if (!open) setEditingId(null); }}
      >
        {editingRecord && (
          <ResolveDialog
            code={editingRecord.code}
            existing={editingRecord}
            onClose={() => setEditingId(null)}
            onRemove={() => { setDeletingId(editingRecord.id); setEditingId(null); }}
          />
        )}
      </Dialog>

      <AlertDialog open={!!deletingId} onOpenChange={(open) => { if (!open) setDeletingId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove resolved place?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deletingRecord?.name}" will be removed from the map. The raw code will return to the unresolved list.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deletingId) await removeMany("places", [deletingId]);
                setDeletingId(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
