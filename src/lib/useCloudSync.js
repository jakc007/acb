import { useEffect, useRef, useState } from "react";
import { createId } from "./calculations.js";
import { createCloudApi, WorkspaceSync, stableStringify } from "./cloudSync.js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
export const cloudConfigured = Boolean(url && key);

export function useCloudSync({ auth, localReady, snapshot, onData }) {
  const enabled = cloudConfigured && !!auth.userId;
  const [status, setStatus] = useState(enabled ? "loading" : "local");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(!enabled);
  const engine = useRef(null);
  const latest = useRef({ snapshot, onData, getToken: auth.getToken });
  latest.current = { snapshot, onData, getToken: auth.getToken };
  const applied = useRef(null);

  useEffect(() => {
    if (!enabled || !localReady) return;
    const cacheKey = `ACB_CLOUD_V1:${url}:${auth.userId}`;
    const sync = new WorkspaceSync({
      api: createCloudApi({ url, key, getToken: () => latest.current.getToken() }),
      cache: {
        read: () => { const value = localStorage.getItem(cacheKey); return value ? JSON.parse(value) : null; },
        write: (value) => localStorage.setItem(cacheKey, JSON.stringify(value)),
      },
      makeId: createId,
      onData: (data) => {
        applied.current = stableStringify(data);
        latest.current.onData(data);
        setReady(true);
      },
      onStatus: (value, message = "") => { setStatus(value); setError(message); },
    });
    engine.current = sync;
    void sync.start(latest.current.snapshot);
    const refresh = () => { if (document.visibilityState !== "hidden") void sync.sync(); };
    const interval = window.setInterval(refresh, 15000);
    window.addEventListener("online", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    const beforeUnload = (event) => {
      if (sync.pending) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      sync.stop();
      window.clearInterval(interval);
      window.removeEventListener("online", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [enabled, localReady, auth.userId]);

  useEffect(() => {
    if (!enabled || !ready || !engine.current?.ready) return;
    if (applied.current) {
      if (stableStringify(snapshot) === applied.current) { applied.current = null; return; }
      // Ignore the render that started initialization; onData has queued a new one.
      if (engine.current.data !== snapshot && status === "loading") return;
      applied.current = null;
    }
    engine.current.change(snapshot);
    const timer = window.setTimeout(() => void engine.current.sync(), 700);
    return () => window.clearTimeout(timer);
  }, [snapshot, enabled, ready]);

  return { enabled, ready, status, error, retry: () => engine.current?.sync(), useCloud: () => engine.current?.useCloud() };
}
