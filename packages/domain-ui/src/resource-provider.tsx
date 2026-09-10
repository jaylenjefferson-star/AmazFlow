"use client";

// The shared data provider, generalized (task 9.4).
//
// `ops/data.tsx` already had the polling discipline this restructure wants everywhere: a fifteen
// second refresh, suspended while the tab is hidden, and per-resource error isolation so one failing
// collection does not blank the console. What it did not have was a shape another surface could
// reuse -- the resource list was hard-coded into the provider, so the customer app would have needed
// a second provider that re-derived the same rules and then drifted from them.
//
// So the rules live here and the resource LIST is a parameter. A surface declares what it reads and
// which permission each read needs; this module owns when to read it, what to do when one read fails,
// and what "loading" means.
//
// The per-resource error isolation is the part worth being explicit about. `Promise.all` over
// throwing loaders would abort the whole refresh on the first failure, which is how a single 403 on
// one collection blanks an entire page. Every load is therefore caught individually and recorded
// against its own key, and a resource that failed keeps its previous value rather than being reset
// to empty -- stale data with a visible error beats no data.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ApiClient } from "@amazflow/api-client";
import { can, type Permission, type Principal } from "@amazflow/permissions";

/** The refresh cadence, from requirement 3.11. */
export const LIVE_POLL_MS = 15_000;

/**
 * One thing a surface reads.
 *
 * `permission` is checked against the same policy the API enforces before the request is made. That
 * is not a security control -- the control plane is -- it is what stops a surface asking for
 * something it will be refused and then displaying that refusal as an error the person cannot act
 * on. A resource whose permission the principal lacks is reported as `unavailable`, not as failed.
 */
export type ResourceSpec<T> = {
  key: string;
  path: string;
  permission: Permission | null;
  /** `true` for the collections that move during a run and are worth re-reading every tick. */
  live?: boolean;
  empty: T;
};

export type ResourceState = "loading" | "ready" | "error" | "unavailable";

export type ResourceSlot<T> = {
  value: T;
  state: ResourceState;
  error: string | null;
  loadedAt: string | null;
};

export type ResourceStore = Record<string, ResourceSlot<unknown>>;

export type ResourceProviderValue = {
  /** Typed read of one declared resource. */
  read: <T>(spec: ResourceSpec<T>) => ResourceSlot<T>;
  /** True until the first full pass has settled, whether or not every resource succeeded. */
  loading: boolean;
  /** Keyed by resource, so a view can render one resource's failure without blanking the page. */
  errors: Record<string, string>;
  lastLoadedAt: string | null;
  refresh: () => Promise<void>;
  refreshLive: () => Promise<void>;
  /** Optimistic local write, for a mutation whose result the server already confirmed. */
  apply: <T>(spec: ResourceSpec<T>, next: T) => void;
};

export function useResources(
  client: ApiClient,
  principal: Principal | null,
  specs: readonly ResourceSpec<unknown>[],
): ResourceProviderValue {
  const [store, setStore] = useState<ResourceStore>(() => initialStore(specs));
  const [loading, setLoading] = useState(true);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);

  // The spec list is stable for a surface but is written inline at the call site, so identity is
  // taken from the keys rather than from the array.
  const specKey = specs.map((spec) => spec.key).join(",");
  const specRef = useRef(specs);
  specRef.current = specs;

  const permitted = useCallback(
    (spec: ResourceSpec<unknown>) => {
      if (spec.permission === null) return true;
      if (!principal) return false;
      return can(principal, spec.permission, { orgId: principal.orgId }).allow;
    },
    [principal],
  );

  const loadOne = useCallback(
    async (spec: ResourceSpec<unknown>) => {
      if (!permitted(spec)) {
        setStore((current) => ({
          ...current,
          [spec.key]: { value: spec.empty, state: "unavailable", error: null, loadedAt: null },
        }));
        return;
      }
      try {
        const value = await client.get<unknown>(spec.path);
        setStore((current) => ({
          ...current,
          [spec.key]: { value, state: "ready", error: null, loadedAt: new Date().toISOString() },
        }));
      } catch (error) {
        // Keep the previous value. A resource that just failed to refresh is more useful shown
        // stale-with-an-error than blanked.
        setStore((current) => ({
          ...current,
          [spec.key]: {
            value: current[spec.key]?.value ?? spec.empty,
            state: "error",
            error: error instanceof Error ? error.message : String(error),
            loadedAt: current[spec.key]?.loadedAt ?? null,
          },
        }));
      }
    },
    [client, permitted],
  );

  const refresh = useCallback(async () => {
    // allSettled, not all: one rejection must not cancel the others.
    await Promise.allSettled(specRef.current.map((spec) => loadOne(spec)));
    setLastLoadedAt(new Date().toISOString());
    setLoading(false);
  }, [loadOne]);

  const refreshLive = useCallback(async () => {
    const live = specRef.current.filter((spec) => spec.live);
    await Promise.allSettled(live.map((spec) => loadOne(spec)));
    setLastLoadedAt(new Date().toISOString());
  }, [loadOne]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, specKey]);

  // Polling suspends while the tab is hidden, so a backgrounded surface stops spending requests, and
  // resumes with an IMMEDIATE read on return rather than waiting out the remaining interval --
  // requirement 3.12, and the difference between "the page was stale for a moment" and "the page
  // lied for fifteen seconds".
  useEffect(() => {
    if (typeof document === "undefined") return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      if (!document.hidden) void refreshLive();
      timer = setTimeout(tick, LIVE_POLL_MS);
    };
    timer = setTimeout(tick, LIVE_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void refreshLive();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshLive]);

  const errors = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [key, slot] of Object.entries(store)) if (slot.error) out[key] = slot.error;
    return out;
  }, [store]);

  const read = useCallback(
    <T,>(spec: ResourceSpec<T>): ResourceSlot<T> =>
      (store[spec.key] as ResourceSlot<T> | undefined) ?? {
        value: spec.empty,
        state: "loading",
        error: null,
        loadedAt: null,
      },
    [store],
  );

  const apply = useCallback(<T,>(spec: ResourceSpec<T>, next: T) => {
    setStore((current) => ({
      ...current,
      [spec.key]: { value: next, state: "ready", error: null, loadedAt: new Date().toISOString() },
    }));
  }, []);

  return { read, loading, errors, lastLoadedAt, refresh, refreshLive, apply };
}

function initialStore(specs: readonly ResourceSpec<unknown>[]): ResourceStore {
  const out: ResourceStore = {};
  for (const spec of specs)
    out[spec.key] = { value: spec.empty, state: "loading", error: null, loadedAt: null };
  return out;
}
