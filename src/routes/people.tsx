import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useCallback } from "react";
import { Users, Upload, ChevronDown, ChevronUp, X, Check } from "lucide-react";
import { toast } from "sonner";
import { useJournal, putMany } from "@/lib/journal/db";
import { parseContacts, type ContactDraft } from "@/lib/journal/contacts";
import { uid, type Person, type Entry } from "@/lib/journal/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/people")({
  head: () => ({
    meta: [
      { title: "People — Journal" },
      { name: "description", content: "The people in your journal." },
    ],
  }),
  component: PeoplePage,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function norm(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

type FilterKind = "all" | "trips" | "culture" | "moments";
const FILTER_LABELS: Record<FilterKind, string> = {
  all: "All",
  trips: "Trips",
  culture: "Culture",
  moments: "Moments",
};

function entryMatchesFilter(e: Entry, f: FilterKind): boolean {
  if (f === "all") return true;
  if (f === "trips") return e.kind === "leg" || e.kind === "stay";
  if (f === "culture") return e.kind === "film" || e.kind === "episode" || e.kind === "book";
  if (f === "moments") return e.kind === "event";
  return true;
}

function personEntryCount(
  person: Person,
  selfId: string | undefined,
  entries: Entry[],
  filter: FilterKind,
): { count: number; lastDate: string | undefined } {
  const filtered = entries.filter((e) => entryMatchesFilter(e, filter));
  let matching: Entry[];
  if (person.isSelf) {
    // Self is implicitly on all entries (participants absent = self present)
    matching = filtered.filter(
      (e) => !e.participants || e.participants.includes(person.id),
    );
  } else {
    matching = filtered.filter(
      (e) => e.participants?.includes(person.id),
    );
  }
  const sorted = [...matching].sort((a, b) => b.start.localeCompare(a.start));
  return { count: matching.length, lastDate: sorted[0]?.start.slice(0, 10) };
}

// ---------------------------------------------------------------------------
// Self setup section
// ---------------------------------------------------------------------------

function SelfSetup({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    const person: Person = {
      id: uid(),
      name: n,
      isSelf: true,
      createdAt: new Date().toISOString(),
    };
    await putMany("people", [person]);
    toast.success(`Welcome, ${n}!`);
    setSaving(false);
    onCreated();
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-6">
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1">
          <h2 className="text-base font-semibold">Set up your profile</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Add your name to appear as the default participant on all your entries.
          </p>
          <div className="mt-4 flex gap-2">
            <Input
              placeholder="Your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
              className="max-w-xs"
              autoFocus
            />
            <Button onClick={() => void save()} disabled={!name.trim() || saving}>
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Self profile row (compact, once set up)
// ---------------------------------------------------------------------------

function SelfRow({ self }: { self: Person }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(self.name);

  async function save() {
    const n = name.trim();
    if (!n) return;
    await putMany("people", [{ ...self, name: n }]);
    toast.success("Profile updated");
    setEditing(false);
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
        {self.name.charAt(0).toUpperCase()}
      </div>
      {editing ? (
        <div className="flex flex-1 items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}
            className="h-7 max-w-xs text-sm"
            autoFocus
          />
          <Button size="sm" variant="ghost" onClick={() => void save()}>Save</Button>
          <Button size="sm" variant="ghost" onClick={() => { setName(self.name); setEditing(false); }}>Cancel</Button>
        </div>
      ) : (
        <>
          <div className="flex-1">
            <span className="text-sm font-medium">{self.name}</span>
            <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">You</span>
          </div>
          <Button size="sm" variant="ghost" className="text-xs text-muted-foreground" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Person card (people index)
// ---------------------------------------------------------------------------

function PersonCard({
  person,
  selfId,
  entries,
  filter,
}: {
  person: Person;
  selfId: string | undefined;
  entries: Entry[];
  filter: FilterKind;
}) {
  const { count, lastDate } = personEntryCount(person, selfId, entries, filter);

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-card px-4 py-3 text-sm">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
        {person.name.charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="font-medium truncate">{person.name}</span>
          {person.aliases?.length ? (
            <span className="text-xs text-muted-foreground truncate">
              also {person.aliases.join(", ")}
            </span>
          ) : null}
        </div>
        {lastDate && (
          <div className="font-mono text-[11px] text-muted-foreground">
            {count} {count === 1 ? "entry" : "entries"} · last {lastDate}
          </div>
        )}
        {!lastDate && count === 0 && (
          <div className="font-mono text-[11px] text-muted-foreground">no entries yet</div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contacts import section
// ---------------------------------------------------------------------------

type ImportedDraft = { draft: ContactDraft; sourceRow: number; selected: boolean; exists: boolean };

function ContactsImport({ existingPeople }: { existingPeople: Person[] }) {
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<ImportedDraft[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const existingNorms = new Set(existingPeople.map((p) => norm(p.name)));

  function handleFile(file: File) {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const result = parseContacts(file.name, text);
      setParseErrors(result.errors);
      const mapped: ImportedDraft[] = result.contacts.map(({ draft, sourceRow }) => {
        const exists = existingNorms.has(norm(draft.name));
        return { draft, sourceRow, selected: !exists, exists };
      });
      setDrafts(mapped);
    };
    reader.readAsText(file);
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [existingPeople]);

  async function importSelected() {
    const selected = drafts.filter((d) => d.selected);
    if (!selected.length) return;
    setImporting(true);
    const people: Person[] = selected.map(({ draft }) => ({
      id: uid(),
      name: draft.name,
      ...(draft.aliases?.length ? { aliases: draft.aliases } : {}),
      createdAt: new Date().toISOString(),
    }));
    await putMany("people", people);
    toast.success(`Imported ${people.length} ${people.length === 1 ? "contact" : "contacts"}`);
    setDrafts([]);
    setParseErrors([]);
    setImporting(false);
  }

  const selectedCount = drafts.filter((d) => d.selected).length;

  return (
    <section className="rounded-lg border border-border">
      <button
        className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-left"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <Upload className="h-4 w-4 text-muted-foreground" />
        Import contacts
        <span className="ml-auto text-muted-foreground">
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
      </button>

      {open && (
        <div className="border-t border-border p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Drop a <strong>.vcf</strong> (vCard) or <strong>.csv</strong> (Google Contacts) file to import contacts as people.
            No data leaves this browser.
          </p>

          {/* Drop zone */}
          {!drafts.length && (
            <div
              className="flex flex-col items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/20 py-10 cursor-pointer hover:bg-muted/40 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Drop file here or click to browse</span>
              <span className="mt-1 font-mono text-[10px] text-muted-foreground">.vcf · .csv</span>
              <input
                ref={inputRef}
                type="file"
                accept=".vcf,.vcard,.csv"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
              />
            </div>
          )}

          {/* Parse errors */}
          {parseErrors.length > 0 && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive space-y-1">
              {parseErrors.map((err, i) => <div key={i}>{err}</div>)}
            </div>
          )}

          {/* Preview list */}
          {drafts.length > 0 && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {drafts.length} contacts found · {selectedCount} selected
                </p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    onClick={() => setDrafts((ds) => ds.map((d) => ({ ...d, selected: !d.exists })))}
                  >
                    Select all new
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    onClick={() => { setDrafts([]); setParseErrors([]); }}
                  >
                    <X className="mr-1 h-3 w-3" /> Clear
                  </Button>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-1 rounded-md border border-border">
                {drafts.map((d, i) => (
                  <button
                    key={i}
                    type="button"
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-sm text-left transition-colors",
                      d.selected ? "bg-primary/5" : "hover:bg-muted/40",
                      d.exists && "opacity-50",
                    )}
                    onClick={() => setDrafts((ds) => ds.map((x, j) => j === i ? { ...x, selected: !x.selected } : x))}
                  >
                    <div className={cn(
                      "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      d.selected ? "border-primary bg-primary text-primary-foreground" : "border-border",
                    )}>
                      {d.selected && <Check className="h-3 w-3" />}
                    </div>
                    <span className="flex-1 truncate">{d.draft.name}</span>
                    {d.draft.aliases?.length ? (
                      <span className="text-xs text-muted-foreground truncate">
                        {d.draft.aliases.join(", ")}
                      </span>
                    ) : null}
                    {d.exists && (
                      <span className="ml-auto font-mono text-[10px] text-muted-foreground">already exists</span>
                    )}
                  </button>
                ))}
              </div>

              <Button
                onClick={() => void importSelected()}
                disabled={!selectedCount || importing}
                className="w-full"
              >
                Import {selectedCount} {selectedCount === 1 ? "contact" : "contacts"}
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

function PeoplePage() {
  const { people, legs, stays, events, films, episodes, books } = useJournal();
  const [filter, setFilter] = useState<FilterKind>("all");
  const [selfSetupKey, setSelfSetupKey] = useState(0); // force re-render after self created

  const self = people.find((p) => p.isSelf);
  const others = [...people.filter((p) => !p.isSelf)].sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  const allEntries: Entry[] = [...legs, ...stays, ...events, ...films, ...episodes, ...books];

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <header>
        <h1 className="font-serif text-3xl font-semibold">People</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The people who appear in your journal.
        </p>
      </header>

      {/* Self setup or profile */}
      {!self ? (
        <SelfSetup key={selfSetupKey} onCreated={() => setSelfSetupKey((k) => k + 1)} />
      ) : (
        <SelfRow self={self} />
      )}

      {/* People index */}
      {people.length > 0 && (
        <section className="space-y-4">
          {/* Filter pills */}
          <div className="flex gap-2 flex-wrap">
            {(Object.keys(FILTER_LABELS) as FilterKind[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80",
                )}
              >
                {FILTER_LABELS[f]}
              </button>
            ))}
          </div>

          {/* Self always first */}
          {self && (
            <PersonCard
              person={self}
              selfId={self.id}
              entries={allEntries}
              filter={filter}
            />
          )}

          {/* Others */}
          {others.length > 0 ? (
            <div className="space-y-2">
              {others.map((p) => (
                <PersonCard
                  key={p.id}
                  person={p}
                  selfId={self?.id}
                  entries={allEntries}
                  filter={filter}
                />
              ))}
            </div>
          ) : (
            self && (
              <p className="text-sm text-muted-foreground">
                No other people yet. Import contacts below to add them.
              </p>
            )
          )}
        </section>
      )}

      {/* Contacts import */}
      <ContactsImport existingPeople={people} />
    </div>
  );
}
