import type { DeckSpec, FreeformElement, StructuredElement, SlidesManualEditOperation } from '@plugin/slides/shared';
import type { SlidesManualEditSourceOperation } from '../definitions/manualEditSourceOperation.js';
import { prepareManualEditSourceOperation } from './prepareManualEditSourceOperation.js';
import { SlidesManualEditSourceError } from './writeManualEditsToDeckSource.js';

/** 批量操作以同一修订为基线；每个作者对象只出现一次，父子不能重复移动或删除。 */
export function prepareManualEditBatch(deck: DeckSpec, operations: readonly SlidesManualEditOperation[]): readonly SlidesManualEditSourceOperation[] {
  const identities = new Set<string>();
  for (const operation of operations) {
    const key = `${operation.target.slideKey}/${operation.target.editKey}`;
    if (identities.has(key)) throw new SlidesManualEditSourceError('operation_invalid', '一个批次不能重复修改同一作者目标。');
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
