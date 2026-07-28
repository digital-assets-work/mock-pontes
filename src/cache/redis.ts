import type { CacheInterface } from "./common.js";
import { createClient } from "redis";

/**
 * Minimal shape of the node-redis client this cache relies on. Declared
 * explicitly so a fake client can be injected in tests (no live Redis needed).
 */
export interface RedisClientLike {
  isReady?: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  connect(): Promise<unknown>;
  quit(): Promise<unknown>;
  set(key: string, value: string, options?: { EX: number }): Promise<string | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
  INCR(key: string): Promise<number>;
  DECR(key: string): Promise<number>;
  SET(key: string, value: string | number): Promise<unknown>;
}

export type RedisClientFactory = () => RedisClientLike;

/**
 * Redis-backed cache.
 *
 * Reliability contract (issue #46):
 * - `connect()` establishes the connection and *rejects* if Redis is
 *   unreachable, so callers can fail fast at startup (the process must not start
 *   with REDIS_URL set but Redis down).
 * - Every operation lazily connects if needed and, on failure, reconnects and
 *   retries **once**. If the retry also fails the error propagates so the caller
 *   can treat the lost write as fatal.
 * - An `error` listener is always attached so a socket error can never surface
 *   as an unhandled exception.
 */
export class RedisCache implements CacheInterface {
  private readonly url: string;
  private readonly prefix: string;
  private readonly clientFactory: RedisClientFactory;
  private client: RedisClientLike | null = null;
  private connecting: Promise<void> | null = null;

  constructor(url: string, prefix: string, clientFactory?: RedisClientFactory) {
    this.url = url;
    this.prefix = prefix;
    this.clientFactory =
      clientFactory ??
      (() =>
        createClient({
          url: this.url,
          socket: {
            // Bounded reconnection for transient blips; give up after a few
            // quick attempts so a genuinely-down Redis surfaces as an error
            // (and is then handled as fatal) rather than retrying forever.
            reconnectStrategy: (retries) =>
              retries > 5 ? false : Math.min(retries * 100, 1000),
          },
        }) as unknown as RedisClientLike);
  }

  private pre(key: string): string {
    return this.prefix + ":" + key;
  }

  /**
   * Establish the connection, rejecting if Redis is unreachable. Safe to call
   * repeatedly; concurrent callers share the same in-flight attempt.
   */
  async connect(): Promise<void> {
    if (this.client?.isReady) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const client = this.clientFactory();
      // Never let an 'error' event become an unhandled exception.
      client.on("error", (err: unknown) =>
        console.error("[mock-pontes] Redis client error:", (err as Error)?.message ?? err),
      );
      await client.connect();
      this.client = client;
    })();
    try {
      await this.connecting;
    } catch (err) {
      this.client = null;
      throw err;
    } finally {
      this.connecting = null;
    }
  }

  private async reconnect(): Promise<void> {
    const old = this.client;
    this.client = null;
    try {
      await old?.quit();
    } catch {
      // best effort — the connection is already broken
    }
    await this.connect();
  }

  /** Run an operation, reconnecting and retrying it once on failure. */
  private async withRetry<T>(op: (client: RedisClientLike) => Promise<T>): Promise<T> {
    if (!this.client?.isReady) await this.connect();
    try {
      return await op(this.client!);
    } catch (err) {
      console.warn(
        `[mock-pontes] Redis operation failed; reconnecting and retrying once: ${(err as Error)?.message ?? err}`,
      );
      await this.reconnect();
      return op(this.client!);
    }
  }

  async inc(key: string): Promise<number> {
    return this.withRetry((c) => c.INCR(this.pre(key)));
  }

  async dec(key: string): Promise<number> {
    return this.withRetry((c) => c.DECR(this.pre(key)));
  }

  async reset(key: string): Promise<number> {
    return this.withRetry(async (c) => {
      await c.SET(this.pre(key), 0);
      return 0;
    });
  }

  async put(key: string, value: any, durationSec: number): Promise<boolean> {
    if (!value) {
      return this.del(key);
    }
    return this.withRetry(async (c) => {
      const k = this.pre(key);
      const v = JSON.stringify(value);
      // Only set an expiry for a positive, finite TTL. A non-positive/NaN
      // duration means "no expiry" — issuing `SET ... EX 0` makes Redis reject
      // the command ("invalid expire time"), which previously crashed the pod.
      const response =
        Number.isFinite(durationSec) && durationSec > 0
          ? await c.set(k, v, { EX: durationSec })
          : await c.set(k, v);
      return response === "OK";
    });
  }

  async get(key: string): Promise<any> {
    return this.withRetry(async (c) => {
      const response = await c.get(this.pre(key));
      if (response && typeof response === "string") {
        return JSON.parse(response);
      }
      return response ?? undefined;
    });
  }

  async del(key: string): Promise<boolean> {
    return this.withRetry(async (c) => (await c.del(this.pre(key))) !== 0);
  }

  close(): void {
    const client = this.client;
    this.client = null;
    // Best-effort; not awaited so the interface stays synchronous.
    void client?.quit().catch(() => {
      /* already closing */
    });
  }
}
