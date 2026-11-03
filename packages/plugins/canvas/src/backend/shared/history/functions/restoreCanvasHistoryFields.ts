import { CanvasElementSchema, type CanvasElement } from '../../../../shared';
import type { CanvasHistoryRestorationMetadata } from '../definitions/canvasHistoryReversal';

export function restoreCanvasHistoryFields(
  before: CanvasElement,
  current: CanvasElement | null,
  fields: readonly string[],
  metadata: CanvasHistoryRestorationMetadata
): CanvasElement {
  const patch: Record<string, unknown> = {};
  for (const field of fields) {
    if (field !== '$existence') patch[field] = Reflect.get(before, field);
  }
  return CanvasElementSchema.parse({
    ...(current ?? before), ...patch, revision: metadata.revision,
    updatedBy: metadata.source, updatedAt: metadata.now,
  });
}
