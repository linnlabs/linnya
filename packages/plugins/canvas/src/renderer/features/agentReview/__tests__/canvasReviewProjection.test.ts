import { describe, expect, it } from 'vitest';
import { CanvasAgentGroupSchema, CanvasTextCardSchema, createCanvasPlainTextDocument, type CanvasAgentGroup } from '@plugin/canvas/shared';
import { projectCanvasReviewMarkers, projectCanvasReviewDirections } from '../functions/projectCanvasReviewMarkers';
import { chooseCanvasReviewGroup, projectCanvasReviewTargets } from '../functions/projectCanvasReviewTargets';
import { canvasReviewReason, projectCanvasWithdrawalSummary } from '../functions/projectCanvasReviewOutcome';
import { selectCanvasReviewTarget } from '../functions/selectCanvasReviewTarget';

function card(id: string, x: number, y = 0) {
  return CanvasTextCardSchema.parse({ id, schemaVersion: 1, createdAt: 1, updatedAt: 1, type: 'text', x, y, width: 100, height: 80, color: 'white', locked: false, order: id, parentId: null, revision: 1, createdBy: { kind: 'agent', conversationId: 'chat', runId: 'run' }, updatedBy: { kind: 'agent', conversationId: 'chat', runId: 'run' }, data: { contentVersion: 1, heightMode: 'auto', content: createCanvasPlainTextDocument(`正文 ${id === 'c3' ? '已删除标题' : '内容'}`) } });
}
function group(patch: Partial<CanvasAgentGroup> = {}) {
  return CanvasAgentGroupSchema.parse({ id: 'group', documentId: 'doc', conversationId: 'chat', runIds: ['run'], createdAt: 1, lastWriteAt: 2, writing: false, reviewedElementIds: [], added: ['c1'], updated: ['c2'], deleted: ['c3'], deletedCards: [card('c3', 300)], visibleDeletedCards: [card('c3', 300)], changes: [{ id: 'c1', kind: 'added', fields: ['$entity'] }, { id: 'c2', kind: 'updated', fields: ['color', 'data', 'x'] }, { id: 'c3', kind: 'deleted', fields: ['$entity'] }], outcomes: { complete: true, skippedWrites: [] }, pendingApproval: null, ...patch });
}
describe('Agent 逐卡审阅投影', () => {
  it('按从左到右再从上到下导航，已查看只隐藏角标，不删除顺序及撤回目标', () => {
    const elements = [card('c1', 100, 100), card('c2', 100, 0)]; const value = group({ reviewedElementIds: [elements[0]!.id] });
    const targets = projectCanvasReviewTargets(value, elements);
    expect(targets.map(target => target.id)).toEqual(['c2', 'c1', 'c3']);
    expect(targets[0]?.description).toBe('Agent 改了颜色、文字或内容');
    expect(selectCanvasReviewTarget(targets, null, 1)?.id).toBe('c2');
    expect(selectCanvasReviewTarget(targets, targets[0]!.id, -1)?.id).toBe('c3');
    expect(projectCanvasReviewMarkers({ groups: [value], elements, camera: { x: 0, y: 0, zoom: 1 }, activeId: value.id }).map(marker => marker.id)).toEqual(['c2', 'c3']);
    expect(projectCanvasReviewMarkers({ groups: [value], elements, camera: { x: 0, y: 0, zoom: 0.29 }, activeId: value.id })).toEqual([]);
    const reopened = { ...value, visibleDeletedCards: [] };
    expect(projectCanvasReviewTargets(reopened, elements)).toHaveLength(3);
    expect(projectCanvasReviewMarkers({ groups: [reopened], elements, camera: { x: 0, y: 0, zoom: 1 }, activeId: value.id }).map(marker => marker.id)).toEqual(['c2']);
  });
  it('合并完全离屏的方向提示，半可见卡不出现提示，删除身份不泄露到标题', () => {
    const value = group(); const markers = projectCanvasReviewMarkers({ groups: [value], elements: [card('c1', -200), card('c2', -50)], camera: { x: 0, y: 0, zoom: 1 }, activeId: value.id });
    const hints = projectCanvasReviewDirections(markers, { width: 200, height: 200 });
    expect(hints.map(hint => [hint.direction, hint.targets.length])).toEqual([['left', 1], ['right', 1]]);
    expect(markers.find(marker => marker.kind === 'deleted')?.title).toBe('正文 已删除标题');
  });
  it('新组或实际新写入替换显示组，普通审阅刷新不抢走手动选择', () => {
    const a = group(), b = group({ id: 'new', lastWriteAt: 3 });
    expect(chooseCanvasReviewGroup([], [a, b], null)).toBe('new');
    expect(chooseCanvasReviewGroup([a, b], [a, b], a.id)).toBe(a.id);
    expect(chooseCanvasReviewGroup([a, b], [{ ...a, lastWriteAt: 4 }, b], b.id)).toBe(a.id);
  });
  it('跳过说明消费正式编辑声明和锁定原因码，不把已知原因退成未知', () => {
    expect(canvasReviewReason('user_editing')).toBe('用户正在编辑');
    expect(canvasReviewReason('element_locked')).toBe('卡片已锁定');
    expect(canvasReviewReason('stale_layout_size')).toBe('测量后卡片尺寸已改变');
  });
  it('测高依赖导致部分保留时逐字段说明，不把成功颜色或跳过正文隐去', () => {
    const result = projectCanvasWithdrawalSummary({ documentId: 'doc', requestId: 'withdraw', sequence: 4, refs: {}, results: [{ id: card('c1', 0).id, index: 0, status: 'applied', reason: 'dependent_field_changed', fieldResults: [{ field: 'data', status: 'skipped', reason: 'dependent_field_changed' }, { field: 'height', status: 'skipped', reason: 'later_fields_preserved' }, { field: 'color', status: 'applied', reason: null }] }] }, [card('c1', 0)]);
    expect(result).toMatchObject({ applied: 1, skipped: 0, retained: 2, canRedo: true });
    expect(result.details.join(' ')).toContain('文字或内容'); expect(result.details.join(' ')).toContain('高度'); expect(result.details.join(' ')).toContain('维持内容与尺寸一致');
  });
  it('部分成功和完整跳过分别说明，保留后写不能假报为全部失败', () => {
    const result = projectCanvasWithdrawalSummary({ documentId: 'doc', requestId: 'withdraw', sequence: 4, refs: {}, results: [{ id: card('c1', 0).id, index: 0, status: 'applied', reason: 'later_fields_preserved' }, { id: card('c2', 0).id, index: 1, status: 'skipped', reason: 'later_use_preserved' }] }, [card('c1', 0), card('c2', 0)]);
    expect(result).toMatchObject({ applied: 1, skipped: 1, retained: 2, canRedo: true, actionId: 'withdraw' });
    expect(result.details.join(' ')).toContain('保留后来修改的字段');
  });
});
