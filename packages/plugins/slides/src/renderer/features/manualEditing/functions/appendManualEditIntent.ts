import type { SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import type {
  ManualEditIntent,
  ManualEditingTranslationPreview,
  ManualEditingVisualPreview,
} from '../definitions/manualEditingTypes';

/**
 * 合并队尾同一作者目标的连续绝对修改，避免用户快速调色或改字号时触发无意义的重复编译。
 * 不跨目标、不跨操作种类合并，以保留用户动作的因果顺序。
 */
export function appendManualEditIntent(
  queued: readonly ManualEditIntent[],
  incoming: ManualEditIntent,
): readonly ManualEditIntent[] {
  const previous = queued[queued.length - 1];
  if (!previous) return [incoming];
  const merged = mergeAdjacentIntents(previous, incoming);
  return merged ? [...queued.slice(0, -1), merged] : [...queued, incoming];
}

function mergeAdjacentIntents(
  previous: ManualEditIntent,
  incoming: ManualEditIntent,
): ManualEditIntent | null {
  if (!targetsMatch(previous.operation, incoming.operation)) return null;
  const operation = mergeOperations(previous.operation, incoming.operation);
  if (!operation) return null;
  const translationPreview = mergeTranslationPreviews(
    previous.translationPreview,
    incoming.translationPreview,
  );
  const visualPreview = mergeVisualPreviews(previous.visualPreview, incoming.visualPreview, operation);
  return {
    operation,
    ...(translationPreview ? { translationPreview } : {}),
    ...(visualPreview ? { visualPreview } : {}),
  };
}

function targetsMatch(
  left: SlidesManualEditOperation,
  right: SlidesManualEditOperation,
): boolean {
  return left.target.slideKey === right.target.slideKey
    && left.target.editKey === right.target.editKey;
}

function mergeOperations(
  previous: SlidesManualEditOperation,
  incoming: SlidesManualEditOperation,
): SlidesManualEditOperation | null {
  if (previous.op !== incoming.op) return null;
  switch (incoming.op) {
    case 'set_text_content':
    case 'set_translation':
    case 'set_fill_color':
    case 'set_visual_size':
      return incoming;
    case 'set_text_style':
      if (previous.op !== 'set_text_style') return null;
      return {
        ...incoming,
        fontSizePt: incoming.fontSizePt ?? previous.fontSizePt,
        color: incoming.color ?? previous.color,
      };
    case 'translate_by':
      if (previous.op !== 'translate_by' || previous.targetKind !== incoming.targetKind) return null;
      return {
        ...incoming,
        delta: {
          dx: previous.delta.dx + incoming.delta.dx,
          dy: previous.delta.dy + incoming.delta.dy,
        },
      };
    case 'delete_target':
      return incoming;
  }
}

function mergeTranslationPreviews(
  previous: ManualEditingTranslationPreview | undefined,
  incoming: ManualEditingTranslationPreview | undefined,
): ManualEditingTranslationPreview | undefined {
  if (!previous || !incoming || previous.elementId !== incoming.elementId) return incoming;
  return {
    elementId: incoming.elementId,
    affectedElementIds: [...new Set([
      ...previous.affectedElementIds,
      ...incoming.affectedElementIds,
    ])],
    dx: previous.dx + incoming.dx,
    dy: previous.dy + incoming.dy,
  };
}

function mergeVisualPreviews(
  previous: ManualEditingVisualPreview | undefined,
  incoming: ManualEditingVisualPreview | undefined,
  operation: SlidesManualEditOperation,
): ManualEditingVisualPreview | undefined {
  if (!incoming) return undefined;
  if (
    operation.op !== 'set_text_style'
    && operation.op !== 'set_fill_color'
    && operation.op !== 'set_visual_size'
    && operation.op !== 'delete_target'
  ) return incoming;
  return {
    ...incoming,
    affectedElementIds: previous?.elementId === incoming.elementId
      ? [...new Set([...previous.affectedElementIds, ...incoming.affectedElementIds])]
      : incoming.affectedElementIds,
    operation,
  };
}
