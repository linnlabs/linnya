// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { ref } from 'vue';
import { CanvasEdgeSchema, type CanvasEdge } from '@plugin/canvas/shared';
import { createCanvasConnectionLabelPreview } from '../orchestration/createCanvasConnectionLabelPreview';

const source = { kind: 'user', conversationId: null, runId: null } as const;
const edge = (label: string): CanvasEdge =>
  CanvasEdgeSchema.parse({
    id: 'e1',
    type: 'edge',
    schemaVersion: 1,
    revision: 1,
    order: 'a0',
    locked: false,
    color: 'white',
    createdBy: source,
    updatedBy: source,
    createdAt: 0,
    updatedAt: 0,
    label,
    direction: 'forward',
    lineStyle: 'curve',
    linePattern: 'solid',
    from: { kind: 'card', cardId: 'c1', side: 'right' },
    to: { kind: 'card', cardId: 'c2', side: 'left' },
  });

it('画布上已完整显示的短标签悬停不弹全文，被截断或含换行的标签才弹', () => {
  const current = ref(edge('关联'));
  const preview = createCanvasConnectionLabelPreview(
    () => current.value,
    text => text.length * 12
  );
  preview.hover(current.value.id);
  expect(preview.content.value).toBeNull();
  current.value = edge('很'.repeat(20));
  expect(preview.content.value?.label).toBe('很'.repeat(20));
  current.value = edge('第一行\n第二行');
  expect(preview.content.value).not.toBeNull();
  preview.dispose();
});
