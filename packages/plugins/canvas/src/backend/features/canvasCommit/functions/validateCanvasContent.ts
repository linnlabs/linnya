import { JsonValueSchema } from '@app/schemas';
import { assertPortableMarkdownDocument } from '@linnya/markdown-document-core';
import type { CanvasCommand, CanvasContentNode, CanvasTextDocument } from '../../../../shared';
import type { CanvasCommitPlan } from '../definitions/canvasCommit';
import { CanvasContentPolicyError } from '../definitions/canvasContentFailure';

/** Workspace Markdown可有普通URL；Canvas只持有受管插图，避免脱离归属与历史保留。 */
export function validateCanvasTextContent(content: CanvasTextDocument): void {
  assertPortableMarkdownDocument(JsonValueSchema.parse(content));
  function visit(node: CanvasContentNode) {
    if (node.type === 'image') {
      const assetId = node.attrs?.assetId;
      if (typeof assetId !== 'string' || !assetId || node.attrs?.src !== `asset:${assetId}`) throw new CanvasContentPolicyError();
    }
    for (const child of node.content ?? []) visit(child);
  }
  visit(content);
}
/** 原始命令正文即使之后因租约/旧实例跳过，也不能把坏格式洗成合法批次。 */
export function validateCanvasCommandContent(command: CanvasCommand): void {
  if (command.op === 'addText') validateCanvasTextContent(command.content);
  if (command.op === 'update' && command.patch.data && 'content' in command.patch.data) validateCanvasTextContent(command.patch.data.content);
}
/** 恢复/撤回也经共同提交，不让可信历史绕过当前正文合同。 */
export function validateCanvasPlanContent(plan: CanvasCommitPlan): void {
  const changed = new Set(plan.changes.filter(change => change.after?.type === 'text' && (!change.before || change.fields.includes('data'))).map(change => change.id));
  for (const row of plan.state.elements) if (row.element.type === 'text' && changed.has(row.element.id)) validateCanvasTextContent(row.element.data.content);
}
