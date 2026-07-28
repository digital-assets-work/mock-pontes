/**
 * Persistence failure handling for MemoryStore (issue #46).
 *
 * A write-through that fails after the cache layer's reconnect/retry must not be
 * silently swallowed (which previously surfaced as an unhandled rejection that
 * crashed the pod). It routes to the injected `onPersistError` handler, which in
 * production stops the process so k8s relaunches it.
 */

import { describe, it, expect, jest } from "@jest/globals";
import { MemoryStore } from "../src/state/memory-store.js";
import type { CacheInterface } from "../src/cache/index.js";

function rejectingCache(): CacheInterface {
  return {
    inc: async () => 0,
    dec: async () => 0,
    reset: async () => 0,
    put: async () => {
      throw new Error("redis write failed after retry");
    },
    get: async () => undefined,
    del: async () => true,
    close: () => {},
  };
}

const flush = () => new Promise((r) => setImmediate(r));

describe("MemoryStore persistence failure (issue #46)", () => {
  it("invokes onPersistError when a write-through fails", async () => {
    const onPersistError = jest.fn();
    const store = new MemoryStore(rejectingCache(), onPersistError);

    store.ensureWallet("W1", { ownerEntityID: "E" });
    store.credit("W1", "10.00");
    await flush();

    expect(onPersistError).toHaveBeenCalled();
    expect(onPersistError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("does not treat an in-memory-only store (no cache) as a failure", async () => {
    const onPersistError = jest.fn();
    const store = new MemoryStore(undefined, onPersistError);

    store.ensureWallet("W2", { ownerEntityID: "E" });
    store.credit("W2", "5.00");
    await flush();

    expect(onPersistError).not.toHaveBeenCalled();
  });
});
