import { useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { putMany } from "@/lib/journal/db";
import { uid, type Purpose, type Trip } from "@/lib/journal/types";

const PURPOSES: Purpose[] = ["work", "family", "leisure", "other"];

export function AddTripDialog() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState<Record<string, string>>({});

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async () => {
    if (busy) return;
    const start = f.start || today;
    const end = f.end || start;
    if (end < start) {
      toast.error("The end date can't be before the start date.");
      return;
    }
    setBusy(true);
    try {
      const trip: Trip = {
        id: uid(),
        title: f.title?.trim() || "Untitled trip",
        start,
        end,
        destinations: (f.destinations ?? "").split(",").map((d) => d.trim()).filter(Boolean),
        notes: f.notes ?? "",
        cover: "",
        createdAt: new Date().toISOString(),
        purpose: (f.purpose as Purpose) || undefined,
      };
      await putMany("trips", [trip]);
      setF({});
      setOpen(false);
      toast.success("Trip created.");
    } catch (error) {
      toast.error(`Could not create trip: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm"><Plus className="h-4 w-4" /> New trip</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>New trip</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Input className="col-span-2" placeholder="Trip title" value={f.title ?? ""} onChange={set("title")} />
          <label className="text-xs text-muted-foreground">Start<Input type="date" value={f.start ?? today} onChange={set("start")} /></label>
          <label className="text-xs text-muted-foreground">End<Input type="date" value={f.end ?? ""} onChange={set("end")} /></label>
          <Input className="col-span-2" placeholder="Destinations (comma separated)" value={f.destinations ?? ""} onChange={set("destinations")} />
          <select
            className="col-span-2 h-9 rounded-md border border-input bg-background px-3 text-sm capitalize"
            value={f.purpose ?? ""}
            onChange={(e) => setF({ ...f, purpose: e.target.value })}
          >
            <option value="">Purpose (optional)</option>
            {PURPOSES.map((p) => <option key={p} value={p} className="capitalize">{p}</option>)}
          </select>
        </div>
        <Textarea placeholder="Trip reflections…" className="font-serif" value={f.notes ?? ""} onChange={set("notes")} />
        <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Create trip"}</Button>
      </DialogContent>
    </Dialog>
  );
}
