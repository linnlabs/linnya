// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { shallowRef } from 'vue';
import { CanvasEdgeSchema, type CanvasEdge } from '@plugin/canvas/shared';
import { createCanvasConnectionLabelPreview } from '../orchestration/createCanvasConnectionLabelPreview';
const edge = CanvasEdgeSchema.parse({ id: 'e1', type: 'edge', schemaVersion: 1, revision: 1, order: 'a0', color: 'white', locked: false, createdBy: { kind: 'user', conversationId: null, runId: null }, updatedBy: { kind: 'user', conversationId: null, runId: null }, createdAt: 0, updatedAt: 0, from: { kind: 'point', x: 0, y: 0 }, to: { kind: 'point', x: 200, y: 100 }, direction: 'forward', lineStyle: 'curve', label: `${'完整标签😀'.repeat(300)}\n可选择复制` });
afterEach(() => vi.useRealTimers());
it('hover全文不截断，跨越canvas与可滚动面板间隙后保持，离开才关闭', () => {
  vi.useFakeTimers(); const current = shallowRef<CanvasEdge | null>(edge), preview = createCanvasConnectionLabelPreview(() => current.value);
  preview.hover(edge.id); expect(preview.content.value?.label).toBe(edge.label);
  preview.hover(null); vi.advanceTimersByTime(80); preview.enter(); vi.advanceTimersByTime(200); expect(preview.content.value?.id).toBe(edge.id);
  current.value = { ...edge, label: 'Agent 刚改的全文' }; expect(preview.content.value?.label).toBe('Agent 刚改的全文');
  preview.leave(); vi.advanceTimersByTime(120); expect(preview.content.value).toBeNull(); preview.dispose();
});
it('已删除标签不保留旧正文，失焦与销毁清理待关闭计时', () => {
  vi.useFakeTimers(); const current = shallowRef<CanvasEdge | null>(edge), preview = createCanvasConnectionLabelPreview(() => current.value);
  preview.hover(edge.id); current.value = null; expect(preview.content.value).toBeNull();
  current.value = edge; preview.hover(edge.id); window.dispatchEvent(new Event('blur')); expect(preview.content.value).toBeNull();
  preview.hover(edge.id); preview.hover(null); preview.dispose(); vi.advanceTimersByTime(500); expect(preview.content.value).toBeNull(); expect(vi.getTimerCount()).toBe(0);
});
