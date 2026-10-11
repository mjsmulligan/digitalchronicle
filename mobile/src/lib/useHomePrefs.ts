import { useCallback, useEffect, useState } from "react";
import { getHomePrefs, setHomePrefs, type HomePrefs } from "./homePrefs";

/**
 * Loads home preferences from disk on mount and exposes an updater that
 * persists changes and keeps local state in sync.
 */
export function useHomePrefs() {
  const [prefs, setPrefsState] = useState<HomePrefs>({ displayName: "", homeAirports: [] });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getHomePrefs().then((p) => {
      setPrefsState(p);
      setLoaded(true);
    });
  }, []);

  const updatePrefs = useCallback(async (update: Partial<HomePrefs>) => {
    await setHomePrefs(update);
    setPrefsState((prev) => ({ ...prev, ...update }));
  }, []);

  return { prefs, loaded, updatePrefs };
}
