import { describe, expect, it } from 'vitest';
import { CanvasCardIdSchema, CanvasElementSchema, type CanvasCard, type CanvasElement } from '@plugin/canvas/shared';
import { buildCanvasDuplication } from '../../clipboard';
import { buildAlignCommands, buildLayerCommands, buildLockCommands } from '../functions/buildCardLayoutCommands';

const user = { kind: 'user', conversationId: null, runId: null };
const base = { schemaVersion: 1, revision: 1, order: 'a0', locked: false, color: 'white', createdBy: user, updatedBy: user, createdAt: 0, updatedAt: 0 };
function card(id: string, x = 0, y = 0, locked = false): CanvasCard {
  const element = CanvasElementSchema.parse({ ...base, id, type: 'text', x, y, width: 280, height: 180, parentId: null, locked, data: { contentVersion: 1, content: { type: 'doc', content: [{ type: 'paragraph', content: [] }] } } });
  if (element.type === 'edge') throw new Error('invalid fixture');
  return element;
}
function edge(id: string, from: string, to: string): CanvasElement {
  return CanvasElementSchema.parse({ ...base, id, type: 'edge', from: { kind: 'card', cardId: from, side: 'auto' }, to: { kind: 'card', cardId: to, side: 'auto' }, direction: 'forward', lineStyle: 'curve', label: 'relation' });
}

describe('卡片编辑计划', () => {
  it('复制子图只带内部连线，并给每个端点建立同批临时引用', () => {
    const cards = [card('c1'), card('c2', 300), card('c3', 600)];
    const elements = [...cards, edge('e1', 'c1', 'c2'), edge('e2', 'c2', 'c3')];
    const plan = buildCanvasDuplication({ elements, ids: [cards[0]!.id, cards[1]!.id], dx: 32, dy: 24, allocateReferenceId: () => 'new-ref' });
    expect(plan.operations).toHaveLength(3);
    expect(plan.operations[0]).toMatchObject({ op: 'addText', ref: '$copy0', x: 32, y: 24 });
    expect(plan.operations[2]).toMatchObject({ op: 'connect', from: '$copy0', to: '$copy1', label: 'relation' });
  });
  it('复制标签保留目标身份，为新位置分配新referenceId', () => {
    const original = card('c1');
    if (original.type !== 'text') throw new Error('text fixture required');
    const tagged = { ...original, data: { ...original.data, content: { type: 'doc' as const, content: [{ type: 'paragraph', content: [{ type: 'documentReference', attrs: { documentId: 'target', referenceId: 'old-ref' } }] }] } } };
    const plan = buildCanvasDuplication({ elements: [tagged], ids: [tagged.id], dx: 1, dy: 1, allocateReferenceId: () => 'new-ref' });
    expect(plan.operations[0]).toMatchObject({ content: { content: [{ content: [{ attrs: { documentId: 'target', referenceId: 'new-ref' } }] }] } });
    expect(tagged.data.content.content[0]?.content?.[0]?.attrs.referenceId).toBe('old-ref');
  });

  it('混合锁定选择可统一解锁；排列与层级遵守锁定边界', () => {
    const first = card('c1', 20, 30, true), second = card('c2', 350, 80);
    const ids = [first.id, second.id];
    expect(buildLockCommands([first, second], ids).map(command => command.op === 'update' && command.patch.locked)).toEqual([true, true]);
    expect(buildAlignCommands([first, second], ids, 'left')).toEqual([{ op: 'update', id: second.id, baseRevision: 1, patch: { x: 350 } }]);
    const layered = buildLayerCommands([first, second], [second.id], 'front');
    expect(layered[0]).toMatchObject({ op: 'update', id: second.id });
    expect(layered[0]?.op === 'update' && layered[0].patch.order).not.toBe(first.order);
  });
  it('大于500个元素的用户复制保持完整，不套用模型原始操作上限', () => {
    const cards = Array.from({ length: 501 }, (_, index) => card(`c${index + 1}`));
    expect(buildCanvasDuplication({ elements: cards, ids: cards.map(value => CanvasCardIdSchema.parse(value.id)), dx: 0, dy: 0, allocateReferenceId: () => 'new-ref' }).operations).toHaveLength(501);
  });
});
