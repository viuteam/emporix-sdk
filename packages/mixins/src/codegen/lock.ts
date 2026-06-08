import { createHash } from "node:crypto";
import type { RawMixin } from "./types";

export interface LockEntry {
  version: number;
  url: string;
  entity: string;
  hash: string;
}
export type Lock = Record<string, LockEntry>;

/** A lockfile keyed by mixin key. `hash` covers the schema content so content-only changes also surface. */
export function buildLock(raw: RawMixin[]): Lock {
  const lock: Lock = {};
  for (const m of raw) {
    lock[m.key] = {
      version: m.version,
      url: m.url,
      entity: m.entity,
      hash: createHash("sha256").update(JSON.stringify(m.schema)).digest("hex").slice(0, 16),
    };
  }
  return lock;
}

/** Returns the keys whose version/url/hash differ between two locks. */
export function diffLock(a: Lock, b: Lock): Array<{ key: string; from?: number; to?: number }> {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const out: Array<{ key: string; from?: number; to?: number }> = [];
  for (const key of keys) {
    const x = a[key];
    const y = b[key];
    if (!x || !y || x.version !== y.version || x.url !== y.url || x.hash !== y.hash) {
      out.push({ key, ...(x ? { from: x.version } : {}), ...(y ? { to: y.version } : {}) });
    }
  }
  return out;
}
