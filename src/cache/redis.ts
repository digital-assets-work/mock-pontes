import type { CacheInterface } from "./common.js";
import { createClient, type RedisClientType } from "redis";

export class RedisCache implements CacheInterface {
  url: string;
  prefix: string;
  client: RedisClientType | null = null;
  reconnectTimer: NodeJS.Timeout | null = null;
  constructor(url: string, prefix: string) {
    // create and connect redis client to local instance.
    // [redis:]//[[user][:password@]][host][:port][/db-number][?db=db-number[&password=bar[&option=value]]
    this.url = url;
    this.prefix = prefix;
    this._initialize();
  }
  private pre(key: string): string {
    return this.prefix + ":" + key;
  }

  private _initialize(): void {
    this.client = createClient({ url: this.url });
    this.client.on("error", this._errorHandler.bind(this));
    this.client.connect();
    this.reconnectTimer = null;
  }

  private _errorHandler(error: any): void {
    console.error("ERROR HANDLER", error);
    this.close();
    if (error.code === "ECONNREFUSED" || error.code === "UNCERTAIN_STATE") {
      this.reconnectTimer = setTimeout(() => this._initialize(), 1000);
    }
  }
  async inc(key: string): Promise<number> {
    if (this.client) {
      const client = this.client;
      const r = await client.INCR(this.pre(key));
      return r;
    } else return Promise.reject("REDIS NOT INITIALIZED");
  }
  async dec(key: string): Promise<number> {
    if (this.client) {
      const client = this.client;
      const r = await client.DECR(this.pre(key));
      return r;
    } else return Promise.reject("REDIS NOT INITIALIZED");
  }
  async reset(key: string): Promise<number> {
    if (this.client) {
      const client = this.client;
      await client.SET(this.pre(key), 0);
      return 0;
    } else return Promise.reject("REDIS NOT INITIALIZED");
  }
  async put(key: string, value: any, durationSec: number): Promise<boolean> {
    if (this.client) {
      const client = this.client;
      if (!value) {
        return await this.del(this.pre(key));
      }
      const duration = durationSec;
      let response: string | null = null;
      if (Number.isNaN(duration)) {
        // no duration, no expiry
        response = await client.set(this.pre(key), JSON.stringify(value));
      } else {
        response = await client.set(this.pre(key), JSON.stringify(value), {
          EX: durationSec,
        });
      }
      return response === "OK";
    } else {
      throw "REDIS NOT INITIALIZED";
    }
  }

  async get(key: string): Promise<any> {
    if (this.client) {
      const client = this.client;
      const response = await client.get(this.pre(key));
      if (response && typeof response === "string") {
        return JSON.parse(response);
      } else {
        return response;
      }
    } else {
      throw "REDIS NOT INITIALIZED";
    }
  }
  async del(key: string): Promise<boolean> {
    if (this.client) {
      const client = this.client;
      const response = await client.del(this.pre(key));
      return response !== 0;
    } else {
      throw "REDIS NOT INITIALIZED";
    }
  }
  close(): void {
    if (this.client) {
      this.client.quit();
    }
    this.client = null;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
  }
}
