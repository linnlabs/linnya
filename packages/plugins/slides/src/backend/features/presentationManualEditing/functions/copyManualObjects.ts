import type { DeckSpec, SlidesAuthoringEditRef } from '@plugin/slides/shared';
import { readCopyableAuthoringValue, type SlidesInsertedObject } from '@plugin/slides/shared/authoringEditing';
import { collectManualAuthoringTargets } from './collectManualAuthoringTargets';

/** 复制作者完整值与已提交几何，不读取 renderer 排版行；不支持的对象明确拒绝，绝不压平丢样式。 */
export function copyManualObjects(deck: DeckSpec, refs: readonly SlidesAuthoringEditRef[]): readonly SlidesInsertedObject[] {
  if (refs.length === 0 || refs.length > 1000) throw new Error('请选择要复制的文字、基础形状或插入的图片。');
  return refs.map(ref => {
    const matches = collectManualAuthoringTargets(deck, ref);
    const match = matches[0];
    if (matches.length !== 1 || !match?.isTopLevel || match.ref.targetKind === 'frame') throw new Error('当前对象不能独立复制；请复制所在幻灯片。');
    const value = readCopyableAuthoringValue(match.element);
    if (!value) throw new Error('当前复制支持文字、纯色矩形/圆形和插入的普通图片；复杂对象请复制整页，以保留全部样式。');
    return { editKey: `inserted-${crypto.randomUUID()}`, box: { ...match.element.position }, ...value };
  });
}
