import type { DeckSpec, FreeformElement, StructuredElement, SlidesManualEditOperation } from '@plugin/slides/shared';
import type { SlidesManualEditSourceOperation } from '../definitions/manualEditSourceOperation.js';
import { prepareManualEditSourceOperation } from './prepareManualEditSourceOperation.js';
import { SlidesManualEditSourceError } from './writeManualEditsToDeckSource.js';

/**
 * 批量操作以同一修订为基线，按顺序写入：同一对象可以连续修改多项（例如左侧宽度手柄的平移加改宽），
 * 后一步建立在前一步之上。只拒绝两种无法成立的组合：删除之后再修改同一对象，以及父子同时入批（会重复移动或删除）。
 */
export function prepareManualEditBatch(deck: DeckSpec, operations: readonly SlidesManualEditOperation[]): readonly SlidesManualEditSourceOperation[] {
  const identities = new Set<string>();
  const deleted = new Set<string>();
  for (const operation of operations) {
    const key = `${operation.target.slideKey}/${operation.target.editKey}`;
    if (deleted.has(key)) throw new SlidesManualEditSourceError('operation_invalid', '同一批次里已删除的对象不能再修改。');
    if (operation.op === 'delete_target') deleted.add(key);
    identities.add(key);
  }
  if (identities.size === 0) throw new SlidesManualEditSourceError('operation_invalid', '批量编辑不能为空。');
  function visit(element: FreeformElement | StructuredElement): void {
    const ref = element._authoringRef;
    if (ref && identities.has(`${ref.slideKey}/${ref.editKey}`)
      && element._authoringAncestorRefs?.some(parent => identities.has(`${parent.slideKey}/${parent.editKey}`))) {
      throw new SlidesManualEditSourceError('operation_invalid', '批量编辑不能同时包含父级和子级作者目标。');
    }
    if (element.type === 'group') for (const child of element.children ?? []) visit(child);
  }
  for (const slide of deck.slides) for (const element of slide.spec.elements) visit(element);
  return operations.map(operation => prepareManualEditSourceOperation(deck, operation));
}
