// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import {
  CanvasAgentGroupSchema,
  CanvasTextCardSchema,
  createCanvasPlainTextDocument,
  type CanvasSnapshot,
} from '@plugin/canvas/shared';
import { createCanvasDocumentSession } from '../../canvasDocument';
import {
  CanvasAgentReviewBar,
  CanvasReviewMarkers,
  createCanvasAgentReview,
  projectCanvasReviewMarkers,
} from '..';

it('真实审阅组件用正文呈现删除身份，只读禁恢复但仍可逐卡定位', async () => {
  const deleted = CanvasTextCardSchema.parse({
    id: 'c1',
    schemaVersion: 1,
    type: 'text',
    revision: 1,
    order: 'a0',
    color: 'white',
    locked: false,
    x: 10,
    y: 20,
    width: 200,
    height: 100,
    parentId: null,
    createdAt: 1,
    updatedAt: 1,
    createdBy: { kind: 'agent', conversationId: 'chat', runId: 'run' },
    updatedBy: { kind: 'agent', conversationId: 'chat', runId: 'run' },
    data: { contentVersion: 1, content: createCanvasPlainTextDocument('原始删除标题') },
  });
  const group = CanvasAgentGroupSchema.parse({
    id: 'group',
    documentId: 'doc',
    conversationId: 'chat',
    runIds: ['run'],
    createdAt: 1,
    lastWriteAt: 1,
    writing: false,
    reviewedElementIds: [],
    added: [],
    updated: [],
    deleted: [deleted.id],
    deletedCards: [deleted],
    visibleDeletedCards: [deleted],
    changes: [{ id: deleted.id, kind: 'deleted', fields: ['$entity'] }],
    outcomes: { complete: true, skippedWrites: [] },
    pendingApproval: null,
  });
  const snapshot: CanvasSnapshot = {
    documentId: 'doc',
    schemaVersion: 1,
    sequence: 1,
    elements: [],
  };
  const session = createCanvasDocumentSession({
    read: async () => snapshot,
    changes: async () => ({ kind: 'snapshot', snapshot }),
    commit: async () => {
      throw new Error('unused');
    },
    editing: async () => {},
    close: async () => {},
    undo: async () => {
      throw new Error('unused');
    },
    subscribe: () => () => {},
  });
  await session.open('doc');
  const reviewed = vi.fn(async () => {});
  const review = createCanvasAgentReview(session, {
    groups: async () => [group],
    withdraw: async () => {
      throw new Error('readonly must not mutate');
    },
    approve: async () => ({ kind: 'denied' }),
    complete: async () => {},
    review: reviewed,
    subscribe: () => () => {},
  });
  await review.refresh();
  const reveal = vi.fn();
  const root = document.createElement('div');
  document.body.append(root);
  const markers = projectCanvasReviewMarkers({
    groups: [group],
    elements: [],
    camera: { x: 0, y: 0, zoom: 1 },
    activeId: group.id,
  });
  const app = createApp({
    render: () =>
      h('div', [
        h(CanvasAgentReviewBar, { review, readonly: true, elements: [], onReveal: reveal }),
        h(CanvasReviewMarkers, { review, readonly: true, markers, onReveal: reveal }),
      ]),
  });
  try {
    app.mount(root);
    await nextTick();
    // 收起态只有一行：摘要、翻页与完成审阅；改动列表在展开面板里。
    const toggle = root.querySelector<HTMLButtonElement>('.canvas-agent-review-summary');
    expect(toggle?.textContent).toContain('Agent 删除 1 张');
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(root.querySelector('.canvas-agent-review-panel')).toBeNull();
    toggle?.click();
    await nextTick();
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelector('.canvas-agent-review-panel')?.textContent).toContain('原始删除标题');
    expect(root.textContent).toContain('原始删除标题');
    expect(root.textContent).not.toContain('c1');
    const restore = [...root.querySelectorAll('button')].filter(
      button => button.textContent?.trim() === '恢复'
    );
    expect(restore.length).toBe(2);
    expect(restore.every(button => button.disabled)).toBe(true);
    const next = root.querySelector<HTMLButtonElement>('[aria-label="下一个改动"]');
    expect(next?.disabled).toBe(false);
    next?.click();
    await nextTick();
    expect(reveal).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'c1',
        kind: 'deleted',
        bounds: { x: 10, y: 20, width: 200, height: 100 },
      })
    );
    expect(reviewed).toHaveBeenCalledWith('doc', deleted.id, group.id);
  } finally {
    app.unmount();
    root.remove();
    review.dispose();
    await session.close();
  }
});

describe('审阅标记只展示当前组', () => {
  it('没有选中组时不合并所有旧 Agent 角标', () => {
    expect(
      projectCanvasReviewMarkers({
        groups: [],
        elements: [],
        camera: { x: 0, y: 0, zoom: 1 },
        activeId: null,
      })
    ).toEqual([]);
  });
});
