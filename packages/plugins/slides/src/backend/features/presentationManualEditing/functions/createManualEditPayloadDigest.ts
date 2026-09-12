import { createHash } from 'node:crypto';
import type { SlidesManualEditCommand } from '@plugin/slides/shared';

/**
 * 摘要只覆盖会改变提交语义的字段，显式序列化可以避免对象属性顺序影响幂等判断。
 */
export function createManualEditPayloadDigest(command: SlidesManualEditCommand): string {
  const operation = command.operation.op === 'set_text_content'
    ? {
        op: command.operation.op,
        slideKey: command.operation.target.slideKey,
        editKey: command.operation.target.editKey,
        content: command.operation.content,
      }
    : command.operation.op === 'set_translation' ? {
        op: command.operation.op,
        slideKey: command.operation.target.slideKey,
        editKey: command.operation.target.editKey,
        targetKind: command.operation.targetKind,
        dx: command.operation.translation.dx,
        dy: command.operation.translation.dy,
      } : {
        op: command.operation.op,
        slideKey: command.operation.target.slideKey,
        editKey: command.operation.target.editKey,
        targetKind: command.operation.targetKind,
        dx: command.operation.delta.dx,
        dy: command.operation.delta.dy,
      };
  return createHash('sha256').update(JSON.stringify({
    documentId: command.documentId,
    expectedBase: command.expectedBase,
    operation,
  })).digest('hex');
}
