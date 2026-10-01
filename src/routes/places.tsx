import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { allEntries, putMany, useJournal } from "@/lib/journal/db";
import { loadStations, locate, normKey, type PlaceInfo } from "@/lib/journal/geo";
import { uid, view, type PlaceRecord } from "@/lib/journal/types";
import { Button } from "@/components/ui/button";

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

function Places() {
  const s = useJournal();
  const [resolving, setResolving] = useState(false);

  // Build lookup map from user-resolved places (IndexedDB)
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

  // Auto-resolve unknown codes against the station dataset when the page loads
  useEffect(() => {
    if (!s.ready || unknown.length === 0) return;
    let cancelled = false;
    setResolving(true);
    loadStations()
      .then(async () => {
        if (cancelled) return;
        const now = new Date().toISOString();
        const resolved: PlaceRecord[] = [];
        for (const [code] of unknown) {
          const info = locate(code);
          if (info) {
            resolved.push({
              id: uid(),
              code,
              name: info.name,
              lat: info.lat,
              lon: info.lon,
              timezone: info.timezone || undefined,
              createdAt: now,
            });
          }
        }
        if (resolved.length > 0 && !cancelled) await putMany("places", resolved);
      })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  // unknown changes every render — only re-run when the count changes or ready flips
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.ready, unknown.length]);

  const color = (m: string) => (m === "air" ? "var(--air)" : m === "rail" ? "var(--rail)" : "var(--road)");
  const { ready } = s;

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-4xl font-semibold">Places</h1>
      <p className="mb-6 text-muted-foreground">
        {points.length} mapped places · drawn offline, nothing leaves your browser.
        {resolving && <span className="ml-2 text-muted-foreground/60">Resolving places…</span>}
      </p>

      {ready && points.length === 0 && unknown.length === 0 && !resolving && (
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
                <tr><th className="py-2">Place</th><th>Appearances</th><th>Why</th></tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.name} className="border-t border-border">
                    <td className="py-2 font-medium">{p.name}</td>
                    <td className="font-mono">{p.count}</td>
                    <td className="max-w-[10rem] truncate text-muted-foreground" title={[...p.kinds].join(", ")}>{[...p.kinds].join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {unknown.length > 0 && (
          <div>
            <h2 className="text-lg">Not on the map</h2>
            <p className="mb-2 text-xs text-muted-foreground">
              {resolving ? "Looking up in offline dataset…" : "Not found in the offline place dataset."}
            </p>
            <ul className="text-sm">
              {unknown.map(([k, n]) => (
                <li key={k}>{k} <span className="font-mono text-muted-foreground">×{n}</span></li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
