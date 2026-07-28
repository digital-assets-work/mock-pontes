/**
 * Unit tests for RedisCache reliability behaviour (issue #46):
 * - a zero / NaN TTL must issue `SET` *without* `EX` (a bare `EX 0` makes Redis
 *   reject the command and previously crashed the pod);
 * - `connect()` must reject when Redis is unreachable so the process can fail
 *   fast at startup;
 * - an operation that fails once must reconnect and retry a single time.
 *
 * A fake client is injected so no live Redis is required.
 */

import { describe, it, expect, jest } from "@jest/globals";
import { RedisCache, type RedisClientLike } from "../src/cache/redis.js";

interface SetCall {
  key: string;
  value: string;
  options?: { EX: number };
}

/** Build a fake redis client and a record of its interactions. */
function makeFakeClient(overrides: Partial<RedisClientLike> = {}) {
  const setCalls: SetCall[] = [];
  const store = new Map<string, string>();
  const client: RedisClientLike = {
    isReady: false,
    on: () => client,
    connect: jest.fn(async () => {
      (client as { isReady: boolean }).isReady = true;
    }),
    quit: jest.fn(async () => {
      (client as { isReady: boolean }).isReady = false;
    }),
    set: jest.fn(async (key: string, value: string, options?: { EX: number }) => {
      setCalls.push({ key, value, options });
      store.set(key, value);
      return "OK";
    }),
    get: jest.fn(async (key: string) => store.get(key) ?? null),
    del: jest.fn(async (key: string) => (store.delete(key) ? 1 : 0)),
    INCR: jest.fn(async () => 1),
    DECR: jest.fn(async () => 0),
    SET: jest.fn(async () => "OK"),
    ...overrides,
  };
  return { client, setCalls, store };
}

describe("RedisCache TTL handling (issue #46)", () => {
  it("issues SET without EX when the TTL is 0 (no expiry)", async () => {
    const { client, setCalls } = makeFakeClient();
    const cache = new RedisCache("redis://x", "p", () => client);

    await cache.put("wallets", [{ a: 1 }], 0);

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].key).toBe("p:wallets");
    expect(setCalls[0].options).toBeUndefined();
  });

  it("issues SET without EX when the TTL is NaN", async () => {
    const { client, setCalls } = makeFakeClient();
    const cache = new RedisCache("redis://x", "p", () => client);

    await cache.put("users", { users: [] }, Number.NaN);

    expect(setCalls[0].options).toBeUndefined();
  });

  it("issues SET with EX for a positive TTL", async () => {
    const { client, setCalls } = makeFakeClient();
    const cache = new RedisCache("redis://x", "p", () => client);

    await cache.put("tok", { t: 1 }, 60);

    expect(setCalls[0].options).toEqual({ EX: 60 });
  });

  it("round-trips a value through get()", async () => {
    const { client } = makeFakeClient();
    const cache = new RedisCache("redis://x", "p", () => client);

    await cache.put("k", { hello: "world" }, 0);
    expect(await cache.get("k")).toEqual({ hello: "world" });
  });
});

describe("RedisCache startup connection (issue #46)", () => {
  it("connect() rejects when Redis is unreachable", async () => {
    const client = makeFakeClient({
      connect: jest.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    }).client;
    const cache = new RedisCache("redis://down", "p", () => client);

    await expect(cache.connect()).rejects.toThrow("ECONNREFUSED");
  });
});

describe("RedisCache reconnect + retry-once (issue #46)", () => {
  it("reconnects and retries a single time when an operation fails", async () => {
    let attempts = 0;
    const base = makeFakeClient();
    const client: RedisClientLike = {
      ...base.client,
      set: jest.fn(async (key: string, value: string, options?: { EX: number }) => {
        attempts += 1;
        if (attempts === 1) throw new Error("connection lost");
        base.setCalls.push({ key, value, options });
        return "OK";
      }),
    };
    // Re-point on/connect/quit to keep isReady coherent across reconnect.
    (client as { isReady: boolean }).isReady = true;
    client.connect = jest.fn(async () => {
      (client as { isReady: boolean }).isReady = true;
    });
    client.quit = jest.fn(async () => {});

    const cache = new RedisCache("redis://x", "p", () => client);
    const ok = await cache.put("wallets", [{ a: 1 }], 0);

    expect(ok).toBe(true);
    expect(attempts).toBe(2); // failed once, succeeded on retry
  });

  it("propagates the error when the retry also fails", async () => {
    const client = makeFakeClient({
      set: jest.fn(async () => {
        throw new Error("still down");
      }),
    }).client;
    (client as { isReady: boolean }).isReady = true;

    const cache = new RedisCache("redis://x", "p", () => client);
    await expect(cache.put("wallets", [{ a: 1 }], 0)).rejects.toThrow("still down");
  });
});
