// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';
import { CanvasEdgeSchema, type CanvasEdge } from '@plugin/canvas/shared';
import { createCanvasConnectionLabelPreview } from '../orchestration/createCanvasConnectionLabelPreview';
const edge = CanvasEdgeSchema.parse({ id: 'e1', type: 'edge', schemaVersion: 1, revision: 1, order: 'a0', color: 'white', locked: false, createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, from: { kind: 'point', x: 0, y: 0 }, to: { kind: 'point', x: 200, y: 100 }, direction: 'forward', lineStyle: 'curve', label: `${'完整标签😀'.repeat(300)}\n可选择复制` });
const measure = (text: string) => text.length * 12;
afterEach(() => vi.useRealTimers());
it('hover全文不截断，跨越canvas与可滚动面板间隙后保持，离开才关闭', () => {
  vi.useFakeTimers(); const current = shallowRef<CanvasEdge | null>(edge), preview = createCanvasConnectionLabelPreview(() => current.value, measure);
  preview.hover(edge.id); expect(preview.content.value?.label).toBe(edge.label);
  preview.hover(null); vi.advanceTimersByTime(80); preview.enter(); vi.advanceTimersByTime(200); expect(preview.content.value?.id).toBe(edge.id);
  const changed = 'Agent 刚改的全文'.repeat(3); current.value = { ...edge, label: changed }; expect(preview.content.value?.label).toBe(changed);
  preview.leave(); vi.advanceTimersByTime(120); expect(preview.content.value).toBeNull(); preview.dispose();
});
it('已删除标签不保留旧正文，失焦与销毁清理待关闭计时', () => {
  vi.useFakeTimers(); const current = shallowRef<CanvasEdge | null>(edge), preview = createCanvasConnectionLabelPreview(() => current.value, measure);
  preview.hover(edge.id); current.value = null; expect(preview.content.value).toBeNull();
  current.value = edge; preview.hover(edge.id); window.dispatchEvent(new Event('blur')); expect(preview.content.value).toBeNull();
  preview.hover(edge.id); preview.hover(null); preview.dispose(); vi.advanceTimersByTime(500); expect(preview.content.value).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});
it('画布上已完整显示的短标签悬停不弹全文，被截断或含换行的标签才弹', () => {
  const current = shallowRef<CanvasEdge | null>({ ...edge, label: '关联' }), preview = createCanvasConnectionLabelPreview(() => current.value, measure);
  preview.hover(edge.id); expect(preview.content.value).toBeNull();
  current.value = { ...edge, label: '很'.repeat(20) }; expect(preview.content.value?.label).toBe('很'.repeat(20));
  current.value = { ...edge, label: '第一行\n第二行' }; expect(preview.content.value).not.toBeNull();
  preview.dispose();
});
