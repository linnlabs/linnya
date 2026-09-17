import type { DeckSpec, SlidesManualEditOperation } from '@plugin/slides/shared';
import { isEditableTextContent } from '@plugin/slides/shared/authoringEditing';
import type { SlidesManualEditSourceOperation } from '../definitions/manualEditSourceOperation.js';
import { collectManualAuthoringTargets } from './collectManualAuthoringTargets.js';
import { SlidesManualEditSourceError } from './writeManualEditsToDeckSource.js';

/** 将本次整框动作展开成同一修订的完整作者值，保留既有 v2 源码的 run 继承语义。 */
export function prepareManualEditSourceOperation(deckSpec: DeckSpec, operation: SlidesManualEditOperation): SlidesManualEditSourceOperation {
  if (operation.op !== 'set_text_style') return operation;
  const matches = collectManualAuthoringTargets(deckSpec, operation.target);
  const match = matches[0];
  if (matches.length !== 1 || !match || match.ref.targetKind !== 'text'
    || (match.element.type !== 'text' && match.element.type !== 'title') || !isEditableTextContent(match.element.content)) {
    throw new SlidesManualEditSourceError('operation_invalid',
      `人工编辑目标 "${operation.target.slideKey}/${operation.target.editKey}" 必须在当前修订中唯一对应可编辑 Text 正文。`);
  }
  return { ...operation, content: match.element.content };
}
