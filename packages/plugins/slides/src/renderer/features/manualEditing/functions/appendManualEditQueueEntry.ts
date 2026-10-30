import { quantizeManualTranslation, type SlidesManualEditCommandOperation, type SlidesManualEditOperation } from '@plugin/slides/shared/authoringEditing';
import type { ManualEditQueueEntry } from '../definitions/manualEditQueue';

/**
 * 队尾尚未提交的同一对象、同一属性修改合并成一次写入，也就只占一步撤销；
 * 快速连点字号、颜色或方向键时不必每下都排队编译。文字会话、层序、插入、页序和撤销各自保留边界。
 */
export function appendManualEditQueueEntry(
  queue: readonly ManualEditQueueEntry[],
  incoming: ManualEditQueueEntry,
): readonly ManualEditQueueEntry[] {
  const previous = queue[queue.length - 1];
  const operation = previous && mergeCommandOperations(previous.intent.operation, incoming.intent.operation);
  if (!previous || !operation) return [...queue, incoming];
  // 位移预览按队列累加，视觉预览按顺序覆盖；直接拼接即与合并后的写入等价。
  const translationPreviews = [...previous.intent.translationPreviews ?? [], ...incoming.intent.translationPreviews ?? []];
  const visualPreviews = [...previous.intent.visualPreviews ?? [], ...incoming.intent.visualPreviews ?? []];
  return [...queue.slice(0, -1), {
    intent: {
      operation,
      ...(translationPreviews.length > 0 ? { translationPreviews } : {}),
      ...(visualPreviews.length > 0 ? { visualPreviews } : {}),
    },
    clientOperationIds: [...previous.clientOperationIds, ...incoming.clientOperationIds],
  }];
}

function mergeCommandOperations(
  previous: SlidesManualEditCommandOperation,
  incoming: SlidesManualEditCommandOperation,
): SlidesManualEditCommandOperation | null {
  if (previous.op === 'batch' && incoming.op === 'batch') {
    if (previous.operations.length !== incoming.operations.length) return null;
    const operations = previous.operations.map((operation, index) => {
      const next = incoming.operations[index];
      return next ? mergeObjectOperations(operation, next) : null;
    });
    return operations.every(operation => operation !== null) ? { op: 'batch', operations } : null;
  }
  return isObjectOperation(previous) && isObjectOperation(incoming) ? mergeObjectOperations(previous, incoming) : null;
}

function isObjectOperation(operation: SlidesManualEditCommandOperation): operation is SlidesManualEditOperation {
  return 'targetKind' in operation || operation.op === 'set_text_style';
}

function mergeObjectOperations(
  previous: SlidesManualEditOperation,
  incoming: SlidesManualEditOperation,
): SlidesManualEditOperation | null {
  if (previous.target.slideKey !== incoming.target.slideKey || previous.target.editKey !== incoming.target.editKey) return null;
  switch (incoming.op) {
    case 'set_fill_color':
    case 'set_text_width':
      return previous.op === incoming.op ? incoming : null;
    // 只合并同一组字段：连点字号合并，先改字号再改颜色仍是两步撤销。
    case 'set_image':
      return previous.op === 'set_image' && sameFields(previous, incoming) ? incoming : null;
    case 'set_text_style':
      return previous.op === 'set_text_style' && sameFields(previous, incoming) ? incoming : null;
    case 'set_visual_size': {
      if (previous.op !== 'set_visual_size') return null;
      // 尺寸是最终绝对值，锚点补偿却是每次手势的增量；后续数字改尺寸也不能丢掉先前位移。
      const dx = (previous.translationDelta?.dx ?? 0) + (incoming.translationDelta?.dx ?? 0);
      const dy = (previous.translationDelta?.dy ?? 0) + (incoming.translationDelta?.dy ?? 0);
      return { ...incoming, ...(previous.translationDelta || incoming.translationDelta ? { translationDelta: { dx, dy } } : {}) };
    }
    case 'translate_by':
      if (previous.op !== 'translate_by' || previous.targetKind !== incoming.targetKind) return null;
      return { ...incoming, delta: quantizeManualTranslation({
        dx: previous.delta.dx + incoming.delta.dx, dy: previous.delta.dy + incoming.delta.dy,
      }) };
    // 每次文字会话和删除都是用户能感知的独立动作，撤销必须逐个回退。
    case 'set_text_content':
    case 'set_translation':
    case 'delete_target':
      return null;
  }
}

function sameFields(left: object, right: object): boolean {
  const fields = (value: object) => Object.entries(value).filter(([, field]) => field !== undefined).map(([key]) => key).sort().join();
  return fields(left) === fields(right);
}
