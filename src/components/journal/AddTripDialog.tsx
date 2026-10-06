import { useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { putMany } from "@/lib/journal/db";
import { uid, type Trip } from "@/lib/journal/types";
import { StarRating } from "@/components/journal/StarRating";

export function AddTripDialog({ trip }: { trip?: Trip }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const blank = (): Record<string, string> =>
    trip
      ? { title: trip.title, start: trip.start, end: trip.end, reflection: trip.reflection ?? trip.notes ?? "" }
      : {};
  const [f, setF] = useState<Record<string, string>>(blank);
  const [rating, setRating] = useState<number | undefined>(trip?.rating);

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
      const next: Trip = {
        id: trip?.id ?? uid(),
        title: f.title?.trim() || "Untitled trip",
        start,
        end,
        cover: trip?.cover ?? "",
        createdAt: trip?.createdAt ?? new Date().toISOString(),
        reflection: f.reflection?.trim() || undefined,
        rating,
      };
      await putMany("trips", [next]);
      if (!trip) { setF({}); setRating(undefined); }
      setOpen(false);
      toast.success(trip ? "Trip saved." : "Trip created.");
    } catch (error) {
      toast.error(`Could not save trip: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) { setF(blank()); setRating(trip?.rating); }
      }}
    >
      <DialogTrigger asChild>
        {trip ? (
          <Button size="sm" variant="outline"><Pencil className="h-4 w-4" /> Edit</Button>
        ) : (
          <Button size="sm"><Plus className="h-4 w-4" /> New trip</Button>
        )}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>{trip ? "Edit trip" : "New trip"}</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          <Input className="col-span-2" placeholder="Trip title" value={f.title ?? ""} onChange={set("title")} />
          <label className="text-xs text-muted-foreground">Start<Input type="date" value={f.start ?? today} onChange={set("start")} /></label>
          <label className="text-xs text-muted-foreground">End<Input type="date" value={f.end ?? ""} onChange={set("end")} /></label>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">Rating</p>
          <StarRating rating={rating} onChange={setRating} />
        </div>
        <Textarea placeholder="Trip reflection…" className="font-serif" value={f.reflection ?? ""} onChange={set("reflection")} />
        <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : trip ? "Save trip" : "Create trip"}</Button>
      </DialogContent>
    </Dialog>
  );
}
