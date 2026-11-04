import type { CanvasAgentGroup, CanvasCommitResult, CanvasElement } from '@plugin/canvas/shared';
import type { CanvasWithdrawalSummary } from '../definitions/agentReview';
import { canvasReviewCardTitle, canvasReviewFields } from './projectCanvasReviewTargets';

const reasons: Readonly<Record<string, string>> = {
  stale_field: '读取后字段已被修改', user_editing: '用户正在编辑', element_locked: '卡片已锁定', stale_layout_size: '测量后卡片尺寸已改变', stale_element: '读取后对象已被修改', element_missing: '对象已不存在',
  later_fields_preserved: '保留后来修改的字段', later_use_preserved: '保留后来使用的对象', later_existence_preserved: '保留后来变更的对象身份',
  stale_measurement: '测高依赖的正文或宽度已改变', stale_geometry: '裁剪或尺寸依赖已改变', partial_fields_skipped: '部分字段未执行',
  dependency_missing: '依赖已不存在或连线重复', restored_nearby: '原位置被占用，已在附近恢复', stale_revision: '读取后对象已被修改',
};
export function canvasReviewReason(reason: string | null): string { return reason ? reasons[reason] ?? '操作未完整执行（未识别的正式原因）' : '未执行'; }
function titleOf(id: string | null, elements: readonly CanvasElement[], group: CanvasAgentGroup | undefined): string {
  const element = elements.find(card => card.id === id) ?? group?.deletedCards.find(card => card.id === id);
  return element && element.type !== 'edge' ? canvasReviewCardTitle(element) : element?.type === 'edge' ? element.label || '连线' : '已不存在的对象';
}
export function projectCanvasWithdrawalSummary(result: CanvasCommitResult, elements: readonly CanvasElement[], group?: CanvasAgentGroup): CanvasWithdrawalSummary {
  const applied = result.results.filter(row => row.status === 'applied').length;
  const skipped = result.results.filter(row => row.status === 'skipped').length;
  const retained = result.results.filter(row => row.reason?.startsWith('later_')).length;
  const details = result.results.filter(row => row.reason !== null || row.status === 'skipped').map(row => `${titleOf(row.id, elements, group)}：${canvasReviewReason(row.reason)}`);
  return { mode: 'withdraw', actionId: result.requestId, applied, skipped, retained, details, canRedo: applied > 0 };
}
export function projectCanvasSkippedWrites(group: CanvasAgentGroup, elements: readonly CanvasElement[]): string[] {
  return group.outcomes.skippedWrites.map(row => `${titleOf(row.id, elements, group)} · ${canvasReviewFields(row.fields)}：${canvasReviewReason(row.reason)}`);
}
