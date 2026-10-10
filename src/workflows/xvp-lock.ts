/**
 * Per-XvP coordination boundary (workbench issue #144).
 *
 * Payment admission/settlement, the expiry transition, and outcome-key
 * disclosure (GET XvP / GET payment) must never interleave for the same XvP:
 * whichever operation is first admitted under this boundary commits the
 * outcome; every other operation on the same XvP id queues strictly FIFO
 * behind it and only then re-reads the committed state — it never observes a
 * half-applied transition. Different XvP ids never block each other (the
 * boundary is keyed per id).
 *
 * `InProcessXvpLock` below is a plain per-key promise queue: correct and
 * sufficient for a single mock-pontes process, which is the deployment this
 * guarantee targets (see docs/DOMAIN-MODEL.md §4's concurrency note). It
 * provides **no** cross-process guarantee. When `REDIS_URL` is set, Redis only
 * persists an asynchronous whole-store snapshot for restart recovery — it is
 * not a synchronously-read, authoritative shared state that multiple replicas
 * could serialize against. Layering a Redis-backed mutex on top of that would
 * only broadcast "who may proceed" while each replica still reads/writes its
 * own stale in-memory copy, which would not actually prevent the races this
 * boundary exists to close. Making that safe needs the store itself to become
 * a shared, atomically-read source of truth — out of scope here, so
 * multi-replica XvP coordination stays an explicit, documented limitation
 * rather than a silently-assumed guarantee.
 */
export interface XvpLock {
  /**
   * Run `fn` while holding the exclusive boundary for `xvpId`. Calls for the
   * same id queue strictly FIFO in call order; calls for different ids never
   * block each other. The boundary is always released once `fn` settles,
   * whether it resolves or throws/rejects — a failed operation never leaves
   * the XvP permanently locked, so a subsequent (e.g. before-deadline retry)
   * call always gets its turn.
   */
  withLock<T>(xvpId: string, fn: () => Promise<T> | T): Promise<T>;
}

export class InProcessXvpLock implements XvpLock {
  private readonly queues = new Map<string, Promise<unknown>>();

  withLock<T>(xvpId: string, fn: () => Promise<T> | T): Promise<T> {
    const previous = this.queues.get(xvpId) ?? Promise.resolve();
    // Run `fn` once `previous` settles, regardless of whether it fulfilled or
    // rejected — a failure ahead of us in the queue must not block our turn.
    const run = previous.then(fn, fn);
    // Chain future callers after `run`, but swallow its rejection here so it
    // never surfaces as an unhandled rejection on the queue itself (the real
    // error still propagates to this call's own caller via `run`).
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(xvpId, settled);
    // Bound memory: drop the entry once nothing else is queued behind us.
    void settled.finally(() => {
      if (this.queues.get(xvpId) === settled) this.queues.delete(xvpId);
    });
    return run;
  }
}
