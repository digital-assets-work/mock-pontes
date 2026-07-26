import type { CacheInterface } from "./common.js";

export class CacheMemory implements CacheInterface {
  private mem: { [key: string]: any };
  private timers: { [key: string]: NodeJS.Timeout };
  constructor() {
    this.mem = {};
    this.timers = {};
  }
  async inc(key: string): Promise<number> {
    this.mem[key] = this.mem[key] + 1;
    return this.mem[key];
  }
  async dec(key: string): Promise<number> {
    this.mem[key] = this.mem[key] - 1;
    return this.mem[key];
  }
  async reset(key: string): Promise<number> {
    this.mem[key] = 0;
    return this.mem[key];
  }
  put(opaque: string, value: any, durationSec: number): Promise<boolean> {
    this.mem[opaque] = value;
    this.mem["X-" + opaque] = { durationSec, accessCount: 0 };

    if (Number.isFinite(durationSec) && durationSec > 0) {
      if (this.timers[opaque]) {
        clearTimeout(this.timers[opaque]);
      }
      this.timers[opaque] = setTimeout(() => {
        delete this.mem[opaque];
        delete this.mem["X-" + opaque];
        delete this.timers[opaque];
      }, durationSec * 1000);
    }
    return Promise.resolve(true);
  }
  get(opaque: string): Promise<any> {
    if (this.mem["X-" + opaque]) {
      this.mem["X-" + opaque].accessCount++;
    }
    return Promise.resolve(this.mem[opaque]);
  }
  close(): void {
    Object.values(this.timers).forEach((timer) => clearTimeout(timer));
    this.timers = {};
    this.mem = {};
  }
  del(key: string): Promise<boolean> {
    delete this.mem[key];
    delete this.mem["X-" + key];
    if (this.timers[key]) {
      clearTimeout(this.timers[key]);
      delete this.timers[key];
    }
    return Promise.resolve(true);
  }
}
