// Vitest setup: load the offline gazetteer before any connector tests run.
// Connectors resolve station names/timezones during parse; the gazetteer is
// lazily imported, and in production stageFile() loads it before parsing.
import { loadStations } from "@/lib/journal/geo";

beforeAll(async () => {
  await loadStations();
});
