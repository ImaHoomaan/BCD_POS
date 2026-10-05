import { useCallback, useEffect, useRef, useState } from 'react';

// Polls `fetcher` on a timer. Requests are flagged as background so they do not extend the
// session idle timer. On failure the last good data stays on screen, `stale` is set and
// the retry interval is used (Req 8.7). Pass fetcher = (opts) => api.get(url, opts).
export function usePolling(fetcher, { interval = 2000, retryInterval = 5000, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [stale, setStale] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;
  const timer = useRef(null);
  const alive = useRef(true);

  const run = useCallback(async () => {
    try {
      const d = await fetchRef.current({ background: true });
      if (!alive.current) return;
      setData(d);
      setStale(false);
      setLoaded(true);
      timer.current = setTimeout(run, interval);
    } catch {
      if (!alive.current) return;
      setStale(true);
      setLoaded(true);
      timer.current = setTimeout(run, retryInterval);
    }
  }, [interval, retryInterval]);

  useEffect(() => {
    alive.current = true;
    if (enabled) run();
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, [run, enabled]);

  // Refresh immediately (for example right after the user saves something).
  const refresh = useCallback(() => {
    clearTimeout(timer.current);
    return run();
  }, [run]);

  return { data, stale, loaded, refresh };
}

export function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
