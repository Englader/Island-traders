import { RESOURCES } from './constants.js';
import type { PartialCounts, Resource, ResourceCounts } from './types.js';

export function emptyCounts(): ResourceCounts {
  return { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
}

export function filledCounts(n: number): ResourceCounts {
  return { brick: n, lumber: n, wool: n, grain: n, ore: n };
}

export function total(c: PartialCounts): number {
  let t = 0;
  for (const r of RESOURCES) t += c[r] ?? 0;
  return t;
}

export function isResource(x: unknown): x is Resource {
  return typeof x === 'string' && (RESOURCES as readonly string[]).includes(x);
}

/** Validates that a partial count object has only known keys and non-negative integers. */
export function validCounts(c: unknown): c is PartialCounts {
  if (typeof c !== 'object' || c === null || Array.isArray(c)) return false;
  for (const [k, v] of Object.entries(c)) {
    if (!isResource(k)) return false;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) return false;
  }
  return true;
}

export function hasAtLeast(have: ResourceCounts, need: PartialCounts): boolean {
  for (const r of RESOURCES) if ((need[r] ?? 0) > have[r]) return false;
  return true;
}

export function addCounts(to: ResourceCounts, c: PartialCounts): void {
  for (const r of RESOURCES) to[r] += c[r] ?? 0;
}

export function subCounts(from: ResourceCounts, c: PartialCounts): void {
  for (const r of RESOURCES) {
    from[r] -= c[r] ?? 0;
    if (from[r] < 0) throw new Error(`negative ${r}`);
  }
}

/** Moves cards between two pools (e.g. player -> bank). */
export function transfer(from: ResourceCounts, to: ResourceCounts, c: PartialCounts): void {
  subCounts(from, c);
  addCounts(to, c);
}

export function countsToList(c: PartialCounts): Resource[] {
  const out: Resource[] = [];
  for (const r of RESOURCES) for (let i = 0; i < (c[r] ?? 0); i++) out.push(r);
  return out;
}

export function listToCounts(list: readonly Resource[]): ResourceCounts {
  const c = emptyCounts();
  for (const r of list) c[r]++;
  return c;
}

export function formatCounts(c: PartialCounts): string {
  const parts: string[] = [];
  for (const r of RESOURCES) if ((c[r] ?? 0) > 0) parts.push(`${c[r]} ${r}`);
  return parts.length ? parts.join(', ') : 'nothing';
}
