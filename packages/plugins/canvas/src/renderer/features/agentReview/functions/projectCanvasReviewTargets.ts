import { readCanvasElementText, type CanvasAgentGroup, type CanvasCard, type CanvasElement, type CanvasElementId } from '@plugin/canvas/shared';
import type { CanvasReviewTarget } from '../definitions/agentReview';

const fieldLabels: Readonly<Record<string, string>> = {
  data: '文字或内容', color: '颜色', width: '宽度', height: '高度', locked: '锁定状态',
  x: '横向位置', y: '纵向位置', order: '层级', parentId: '分组', $entity: '整张卡片',
  from: '起点', to: '终点', label: '连线文字', direction: '箭头', lineStyle: '曲直', linePattern: '线型',
};
export function canvasReviewFields(fields: readonly string[] | null): string {
  return fields === null ? '字段信息未记录' : [...new Set(fields.map(field => fieldLabels[field] ?? '其他字段'))].join('、');
}
export function canvasReviewCardTitle(card: CanvasCard, documentTitles?: ReadonlyMap<string, string>): string {
  if (card.type === 'document') return documentTitles?.get(card.data.documentId) ?? '文档';
  return readCanvasElementText(card).replace(/\s+/g, ' ').trim().slice(0, 64) || (card.type === 'image' ? '图片' : '空白文字卡');
}
export function projectCanvasReviewTargets(group: CanvasAgentGroup, elements: readonly CanvasElement[], documentTitles?: ReadonlyMap<string, string>): CanvasReviewTarget[] {
  const live = new Map<CanvasElementId, CanvasCard>(elements.filter(element => element.type !== 'edge').map(card => [card.id, card]));
  const deleted = new Map<CanvasElementId, CanvasCard>(group.deletedCards.filter(card => !live.has(card.id)).map(card => [card.id, card]));
  return group.changes.flatMap(change => {
    const card = change.kind === 'deleted' ? deleted.get(change.id) : live.get(change.id);
    if (!card) return [];
    const description = change.kind === 'added' ? 'Agent 新增' : change.kind === 'deleted' ? 'Agent 删除' : `Agent 改了${canvasReviewFields(change.fields.filter(field => !['x', 'y', 'order', 'parentId'].includes(field)))}`;
    return [{ id: card.id, groupId: group.id, kind: change.kind, bounds: { x: card.x, y: card.y, width: card.width, height: card.height }, title: canvasReviewCardTitle(card, documentTitles), description }];
  }).sort((left, right) => left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y || left.id.localeCompare(right.id));
}
/** 只有新的实际写入替换当前显示组；审阅/跳过结果刷新不会抢走用户正在查看的旧组。 */
export function chooseCanvasReviewGroup(previous: readonly CanvasAgentGroup[], groups: readonly CanvasAgentGroup[], activeId: string | null): string | null {
  const latest = [...groups].sort((a, b) => b.lastWriteAt - a.lastWriteAt || b.createdAt - a.createdAt)[0];
  if (!latest) return null;
  const old = previous.find(group => group.id === latest.id);
  if (!old || latest.lastWriteAt > old.lastWriteAt || !groups.some(group => group.id === activeId)) return latest.id;
  return activeId;
}
