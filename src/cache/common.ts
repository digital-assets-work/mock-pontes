/**
 * Minimal cache abstraction used by mock-pontes for optional Redis-backed
 * persistence of runtime PKI and enrolled users. Vendored (previously provided
 * by an internal shared library) so this project has no external workspace deps.
 */

export interface CacheInterface {
  inc(key: string): Promise<number>;
  dec(key: string): Promise<number>;
  reset(key: string): Promise<number>;
  put<T = any>(key: string, data: T, durationSec: number): Promise<boolean>;
  get<T>(key: string): Promise<T | undefined>;
  del(key: string): Promise<boolean>;
  close(): void;
}

/**
 * Default handler for a persistence failure that survives the cache layer's
 * reconnect-and-retry. Per issue #46 a lost write must not be silently ignored:
 * the mock stops so the orchestrator (k8s) can relaunch it with a fresh
 * connection, rather than continuing to serve state that was never persisted.
 * Injected into the store/repositories so tests can substitute a spy.
 */
export function fatalPersistError(err: unknown): void {
  console.error(
    "[mock-pontes] FATAL: Redis persistence failed after reconnect/retry; stopping so the orchestrator can relaunch.",
    err,
  );
  process.exit(1);
}

