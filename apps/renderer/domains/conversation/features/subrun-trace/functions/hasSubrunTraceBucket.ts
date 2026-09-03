import { isRecord } from '../../../utils/typeGuards';
import type { SubrunTraceBucket, SubrunTraceBucketMap } from '../definitions/subrunTrace';

export function isSubrunTraceBucket(value: unknown): value is SubrunTraceBucket {
  if (!isRecord(value)) return false;
  const subrunId = value['subrun_id'];
  const events = value['events'];
  return typeof subrunId === 'string'
    && subrunId.trim().length > 0
    && Array.isArray(events);
}

export function findSubrunTraceBucket(
  raw: unknown,
  expectedSubrunId?: string,
): SubrunTraceBucket | null {
  const buckets = readSubrunTraceBuckets(raw);
  if (expectedSubrunId) return buckets[expectedSubrunId] ?? null;
  const values = Object.values(buckets);
  return values.length === 1 ? values[0] ?? null : null;
}

export function hasSubrunTraceBucket(raw: unknown, expectedSubrunId?: string): boolean {
  return findSubrunTraceBucket(raw, expectedSubrunId) !== null;
}

export function readSubrunTraceBuckets(raw: unknown): SubrunTraceBucketMap {
  if (!isRecord(raw)) return {};
  const buckets: SubrunTraceBucketMap = {};
  for (const value of Object.values(raw)) {
    if (!isSubrunTraceBucket(value)) continue;
    buckets[value.subrun_id] = value;
  }
  return buckets;
}

export function readSubrunTraceSourceKey(raw: unknown): string | null {
  for (const bucket of Object.values(readSubrunTraceBuckets(raw))) {
    const event = bucket.events[0];
    if (!event) continue;
    if (!event.conversation_id || !event.parent_tool_call_id) continue;
    return `${event.conversation_id}|${event.parent_tool_call_id}`;
  }
  return null;
}
