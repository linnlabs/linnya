import { describe, expect, it } from 'vitest';
import type { ManualEditableTarget } from '../../manualEditing';
import { normalizeManualSelection, collectManualMarqueeSelection } from '../../manualEditing';
import { arrangeSelection } from './arrangeSelection';
import { snapCanvasTranslation } from '../../editingInteraction/functions/snapCanvasTranslation';

function target(id: string, x: number, w: number, parent?: string): ManualEditableTarget {
  return { elementId: id, nodeKind: 'shape', targetKind: 'shape', capabilities: ['translate', 'delete'],
    authoringRef: { slideKey: 'page', editKey: id }, authoringAncestorRefs: parent ? [{ slideKey: 'page', editKey: parent, targetKind: 'frame' }] : [],
    bounds: { x, y: 1, w, h: 1 }, polygon: [{ x, y: 1 }, { x: x + w, y: 1 }, { x: x + w, y: 2 }, { x, y: 2 }], translationElementIds: [id] };
}
describe('选择、对齐和吸附的作者几何', () => {
  it('父子同时入选时只移动父级；框选只收完全框住的对象，追加选择保留已有对象', () => {
    const parent = target('group', 1, 4); const child = target('child', 2, 1, 'group'); const other = target('other', 8, 1);
    expect(normalizeManualSelection([child, parent, parent])).toEqual([parent]);
    expect(collectManualMarqueeSelection([parent, child], { x: 1, y: 1, w: 3, h: 2 }, [other])).toEqual([other, child]);
    expect(collectManualMarqueeSelection([parent, child], { x: 1, y: 1, w: 4, h: 2 }, [other])).toEqual([other, parent]);
  });
  it('多选右对齐一次批量提交；单选中心对齐到页面', () => {
    const intent = arrangeSelection([target('a', 1, 2), target('b', 4, 1), target('c', 8, 2)], 'right', { width: 12, height: 6 });
    expect(intent?.operation).toMatchObject({ op: 'batch', operations: [
      { target: { editKey: 'a' }, delta: { dx: 7, dy: 0 } }, { target: { editKey: 'b' }, delta: { dx: 5, dy: 0 } },
    ] });
    expect(arrangeSelection([target('a', 1, 2)], 'center', { width: 12, height: 6 })?.operation).toMatchObject({ op: 'translate_by', delta: { dx: 4, dy: 0 } });
  });
  it('不同宽度的对象等距分布固定外侧边界，已经等距不写入', () => {
    const intent = arrangeSelection([target('a', 0, 2), target('b', 3, 1), target('c', 8, 2)], 'distributeX', { width: 12, height: 6 });
    expect(intent?.operation).toMatchObject({ op: 'translate_by', target: { editKey: 'b' }, delta: { dx: 1.5, dy: 0 } });
    expect(arrangeSelection([target('a', 0, 2), target('b', 4.5, 1), target('c', 8, 2)], 'distributeX', { width: 12, height: 6 })).toBeNull();
  });
  it('吸附阈值随缩放保持屏幕 6px，Alt 取消吸附，Shift 保持主轴', () => {
    const input = { bounds: { x: 1, y: 1, w: 2, h: 1 }, peers: [], slideSize: { width: 10, height: 6 }, delta: { dx: 2.96, dy: 0.3 }, renderScale: 1, disabled: false, axisLock: false };
    expect(snapCanvasTranslation(input).delta.dx).toBe(3);
    expect(snapCanvasTranslation({ ...input, renderScale: 2 }).delta.dx).toBe(2.96);
    expect(snapCanvasTranslation({ ...input, disabled: true, axisLock: true }).delta).toEqual({ dx: 2.96, dy: 0 });
  });
});
