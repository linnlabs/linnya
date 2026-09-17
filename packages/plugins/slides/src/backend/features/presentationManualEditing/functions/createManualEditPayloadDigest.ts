import { createHash } from 'node:crypto';
import type { SlidesManualEditCommand } from '@plugin/slides/shared';

/**
 * 摘要只覆盖会改变提交语义的字段，显式序列化可以避免对象属性顺序影响幂等判断。
 */
export function createManualEditPayloadDigest(command: SlidesManualEditCommand): string {
  const operation = serializeOperation(command.operation);
  return createHash('sha256').update(JSON.stringify({
    documentId: command.documentId,
    expectedBase: command.expectedBase,
    operation,
  })).digest('hex');
}

function serializeOperation(operation: SlidesManualEditCommand['operation']): object {
  const target = {
    slideKey: operation.target.slideKey,
    editKey: operation.target.editKey,
  };
  switch (operation.op) {
    case 'set_text_content':
      return { op: operation.op, ...target, targetKind: operation.targetKind, content: serializeTextContent(operation.content) };
    case 'set_text_style':
      return {
        op: operation.op,
        ...target,
        fontSizePt: operation.fontSizePt,
        color: operation.color,
      };
    case 'set_translation':
      return {
        op: operation.op,
        ...target,
        targetKind: operation.targetKind,
        dx: operation.translation.dx,
        dy: operation.translation.dy,
      };
    case 'translate_by':
      return {
        op: operation.op,
        ...target,
        targetKind: operation.targetKind,
        dx: operation.delta.dx,
        dy: operation.delta.dy,
      };
    case 'set_fill_color':
      return { op: operation.op, ...target, targetKind: operation.targetKind, color: operation.color };
    case 'set_visual_size':
      return {
        op: operation.op,
        ...target,
        targetKind: operation.targetKind,
        width: operation.visualSize.width,
        height: operation.visualSize.height,
        translationDelta: operation.translationDelta ? {
          dx: operation.translationDelta.dx, dy: operation.translationDelta.dy,
        } : undefined,
      };
    case 'delete_target':
      return { op: operation.op, ...target, targetKind: operation.targetKind };
  }
}

/** run 对象属性顺序不属于作者语义；重试时 JSON 重排不能变成另一个命令。 */
function serializeTextContent(content: Extract<SlidesManualEditCommand['operation'], { op: 'set_text_content' }>['content']) {
  if (typeof content === 'string') return content;
  return content.map(run => ({ text: run.text, ...(run.style ? { style: {
    fontSize: run.style.fontSize, fontFamily: run.style.fontFamily, bold: run.style.bold,
    italic: run.style.italic, underline: run.style.underline, color: run.style.color,
    align: run.style.align, valign: run.style.valign, letterSpacing: run.style.letterSpacing,
    lineSpacing: run.style.lineSpacing ? { kind: run.style.lineSpacing.kind, value: run.style.lineSpacing.value } : undefined,
  } } : {}) }));
}
