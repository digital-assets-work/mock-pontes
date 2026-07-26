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
