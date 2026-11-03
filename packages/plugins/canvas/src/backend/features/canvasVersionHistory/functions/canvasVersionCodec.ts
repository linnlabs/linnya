import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { JsonValueSchema, type JsonValue } from '@app/schemas';
import { DocumentHistoryError } from '@plugin/backend/documentHistory';
import { CanvasElementSchema, CanvasSnapshotSchema, type CanvasElement, type CanvasSnapshot } from '../../../../shared';
import type { CanvasElementChange } from '../../canvasCommit';
import { CanvasVersionInverseSchema, type CanvasVersionElementInverse, type CanvasVersionInverse } from '../definitions/canvasVersionHistory';

function json(value: unknown): JsonValue { const serialized: unknown = JSON.parse(JSON.stringify(value)); return JsonValueSchema.parse(serialized); }
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function canvasVersionSnapshot(snapshot: CanvasSnapshot): CanvasSnapshot {
  if ('integrity' in snapshot) throw new DocumentHistoryError('history_unavailable');
  const parsed = CanvasSnapshotSchema.parse(snapshot);
  return { ...parsed, elements: [...parsed.elements].sort((left, right) => left.id.localeCompare(right.id)) };
}
export function canvasVersionHash(snapshot: CanvasSnapshot): string { return createHash('sha256').update(canonical(json(canvasVersionSnapshot(snapshot)))).digest('hex'); }
export function encodeCanvasVersion(value: unknown): Uint8Array { return gzipSync(canonical(json(value))); }
export function decodeCanvasVersion(bytes: Uint8Array): unknown { try { const value: unknown = JSON.parse(gunzipSync(bytes).toString('utf8')); return value; } catch { throw new DocumentHistoryError('version_corrupt'); } }
export function decodeCanvasVersionInverse(bytes: Uint8Array | null): CanvasVersionInverse { return bytes ? CanvasVersionInverseSchema.parse(decodeCanvasVersion(bytes)) : []; }
function object(value: JsonValue): { [key: string]: JsonValue } { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DocumentHistoryError('version_corrupt'); return value; }
function applyElement(element: CanvasElement | null, inverse: CanvasVersionElementInverse): CanvasElement | null {
  if (inverse.kind === 'remove') return null;
  if (inverse.kind === 'put') { if (inverse.element.id !== inverse.id) throw new DocumentHistoryError('version_corrupt'); return inverse.element; }
  if (!element) throw new DocumentHistoryError('version_corrupt');
  const next = { ...object(json(element)), ...inverse.fields };
  for (const key of inverse.unset) delete next[key];
  const result = CanvasElementSchema.parse(next);
  if (result.id !== inverse.id) throw new DocumentHistoryError('version_corrupt');
  return result;
}
function inverseBetween(id: CanvasElement['id'], current: CanvasElement | null, target: CanvasElement | null): CanvasVersionElementInverse | null {
  if (!target) return current ? { kind: 'remove', id } : null;
  if (!current) return { kind: 'put', id, element: target };
  const before = object(json(target)), after = object(json(current));
  const fields: { [key: string]: JsonValue } = {}, unset: string[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (canonical(before[key] ?? null) === canonical(after[key] ?? null) && Object.prototype.hasOwnProperty.call(before, key) === Object.prototype.hasOwnProperty.call(after, key)) continue;
    if (Object.prototype.hasOwnProperty.call(before, key)) fields[key] = before[key]; else unset.push(key);
  }
  return Object.keys(fields).length || unset.length ? { kind: 'patch', id, fields, unset } : null;
}
/** 每次只重新比较本批实际改过的元素；普通移动不会把未修改正文写入逆增量。 */
export function mergeCanvasVersionHead(previous: CanvasVersionInverse, changes: readonly CanvasElementChange[]): CanvasVersionInverse {
  const values = new Map(previous.map(inverse => [inverse.id, inverse]));
  for (const change of changes) {
    const old = values.get(change.id); const target = old ? applyElement(change.before, old) : change.before;
    const next = inverseBetween(change.id, change.after, target);
    if (next) values.set(change.id, next); else values.delete(change.id);
  }
  return [...values.values()];
}
export function applyCanvasVersionInverse(snapshot: CanvasSnapshot, inverse: CanvasVersionInverse, sequence: number): CanvasSnapshot {
  const elements = new Map(snapshot.elements.map(element => [element.id, element]));
  for (const change of inverse) { const next = applyElement(elements.get(change.id) ?? null, change); if (next) elements.set(change.id, next); else elements.delete(change.id); }
  return canvasVersionSnapshot({ ...snapshot, sequence, elements: [...elements.values()] });
}
/** 裁剪只合并字段操作，不重新 diff 整张画布；更旧的目标值拥有最终优先权。 */
export function composeCanvasVersionInverse(newer: CanvasVersionInverse, older: CanvasVersionInverse): CanvasVersionInverse {
  const result = new Map(newer.map(change => [change.id, change]));
  for (const change of older) {
    const previous = result.get(change.id);
    if (!previous || change.kind !== 'patch') { result.set(change.id, change); continue; }
    if (previous.kind === 'remove') throw new DocumentHistoryError('version_corrupt');
    if (previous.kind === 'put') {
      const element = applyElement(previous.element, change); if (!element) throw new DocumentHistoryError('version_corrupt');
      result.set(change.id, { kind: 'put', id: change.id, element }); continue;
    }
    const fields = { ...previous.fields }, unset = new Set(previous.unset);
    for (const [key, value] of Object.entries(change.fields)) { fields[key] = value; unset.delete(key); }
    for (const key of change.unset) { delete fields[key]; unset.add(key); }
    result.set(change.id, { kind: 'patch', id: change.id, fields, unset: [...unset] });
  }
  return [...result.values()];
}
