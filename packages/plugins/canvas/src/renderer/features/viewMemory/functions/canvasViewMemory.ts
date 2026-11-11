import { isRecord } from '@linnya/foundation';
import type { CanvasCamera } from '@plugin/canvas/shared';

/** 每份画布在本机记住的最后视口；超过上限时丢弃最久没打开的。 */
export interface CanvasViewMemoryEntry {
  readonly camera: CanvasCamera;
  readonly at: number;
}
export type CanvasViewMemory = Readonly<Record<string, CanvasViewMemoryEntry>>;

export const canvasViewMemoryLimit = 200;

function readCamera(value: unknown): CanvasCamera | null {
  if (!isRecord(value)) return null;
  const { x, y, zoom } = value;
  return typeof x === 'number' &&
    Number.isFinite(x) &&
    typeof y === 'number' &&
    Number.isFinite(y) &&
    typeof zoom === 'number' &&
    Number.isFinite(zoom) &&
    zoom > 0
    ? { x, y, zoom }
    : null;
}

/** 本机存储可能来自旧版本或被手工改坏；只保留结构完整的记录，坏记录当作没有。 */
export function parseCanvasViewMemory(raw: string | null): CanvasViewMemory {
  if (raw === null) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isRecord(parsed)) return {};
  const memory: Record<string, CanvasViewMemoryEntry> = {};
  for (const [documentId, entry] of Object.entries(parsed)) {
    if (!isRecord(entry)) continue;
    const camera = readCamera(entry.camera);
    if (camera && typeof entry.at === 'number') memory[documentId] = { camera, at: entry.at };
  }
  return memory;
}

export function rememberCanvasView(
  memory: CanvasViewMemory,
  documentId: string,
  view: CanvasViewMemoryEntry,
  limit = canvasViewMemoryLimit
): CanvasViewMemory {
  const entries = Object.entries({ ...memory, [documentId]: view });
  if (entries.length <= limit) return Object.fromEntries(entries);
  return Object.fromEntries(
    entries.sort(([, left], [, right]) => right.at - left.at).slice(0, limit)
  );
}
