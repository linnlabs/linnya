import type {
  ManualEditIntent,
  ManualEditingTranslationPreview,
  ManualEditingVisualPreview,
} from '../definitions/manualEditingTypes';

export function collectManualVisualPreviews(
  pending: ManualEditingVisualPreview | null,
  queuedIntents: readonly ManualEditIntent[],
): readonly ManualEditingVisualPreview[] {
  return [
    ...(pending ? [pending] : []),
    ...queuedIntents.flatMap(intent => intent.visualPreview ? [intent.visualPreview] : []),
  ];
}

/** 同一 RenderNode 可能同时属于父 Frame 与子对象，队列位移必须按作者层级累加。 */
export function mergeManualTranslationPreviews(
  previews: readonly ManualEditingTranslationPreview[],
): ReadonlyMap<string, ManualEditingTranslationPreview> {
  const merged = new Map<string, ManualEditingTranslationPreview>();
  for (const preview of previews) {
    for (const elementId of preview.affectedElementIds) {
      const current = merged.get(elementId);
      merged.set(elementId, {
        elementId: preview.elementId,
        affectedElementIds: [elementId],
        dx: (current?.dx ?? 0) + preview.dx,
        dy: (current?.dy ?? 0) + preview.dy,
      });
    }
  }
  return merged;
}

export function collectManualTranslationPreviews(
  transient: ManualEditingTranslationPreview | null,
  pending: ManualEditingTranslationPreview | null,
  queuedIntents: readonly ManualEditIntent[],
): readonly ManualEditingTranslationPreview[] {
  return [
    ...(transient ? [transient] : []),
    ...(pending ? [pending] : []),
    ...queuedIntents.flatMap(intent => (
      intent.translationPreview ? [intent.translationPreview] : []
    )),
  ];
}

export function resolveManualTargetTranslation(
  elementId: string | undefined,
  previews: readonly ManualEditingTranslationPreview[],
): ManualEditingTranslationPreview | null {
  if (!elementId) return null;
  const matching = previews.filter(preview => preview.elementId === elementId);
  if (matching.length === 0) return null;
  return {
    elementId,
    affectedElementIds: [...new Set(matching.flatMap(preview => preview.affectedElementIds))],
    dx: matching.reduce((sum, preview) => sum + preview.dx, 0),
    dy: matching.reduce((sum, preview) => sum + preview.dy, 0),
  };
}
