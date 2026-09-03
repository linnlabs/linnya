import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { StartTableAiModeSessionInput } from '../definitions/tableAiMode';
import { useTableAiModeStore } from './tableAiModeStore';

function sessionInput(sessionId = 'session-1'): StartTableAiModeSessionInput {
  return {
    sessionId,
    table: {
      editorId: 'main',
      rootBlockId: 'root-1',
      lastKnownPos: 10,
    },
    context: {
      columnRefs: [{
        name: 'A',
        reference: 'A',
        range: 'A',
        rect: { top: 0, bottom: 2, left: 0, right: 1 },
      }],
      selectionRange: 'A1:A2',
      outputColumnRange: 'B1:B2',
      activeColumnRefs: {},
      outputRect: { top: 0, bottom: 2, left: 1, right: 2 },
      outputColumnAdded: true,
      insertedColumnIndex: 1,
    },
  };
}

describe('tableAiModeStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('以 sessionId 约束 active -> closing -> off，并阻止 closing 期间重入', () => {
    const store = useTableAiModeStore();
    const input = sessionInput();
    store.startSession(input);

    expect(store.phase).toBe('active');
    expect(store.isActive).toBe(true);
    expect(store.activeTable).toEqual(input.table);
    expect(store.activeContext).toEqual(input.context);
    expect(store.beginClosing('session-1')).toBe(true);
    expect(store.phase).toBe('closing');
    expect(store.isActive).toBe(false);
    expect(store.activeTable).toBeNull();
    expect(store.activeContext).toBeNull();
    expect(() => store.startSession(sessionInput('session-2')))
      .toThrow('当前 phase=closing，不能开始新会话');
    expect(store.completeClosing('session-2')).toBe(false);
    expect(store.phase).toBe('closing');
    expect(store.completeClosing('session-1')).toBe(true);
    expect(store.phase).toBe('off');
    expect(store.session).toBeNull();
  });

  it('只允许当前 controller 结算执行态', () => {
    const store = useTableAiModeStore();
    const input = sessionInput();
    store.startSession(input);
    const controller = new AbortController();
    const staleController = new AbortController();

    expect(store.beginExecution(controller)).toBe(true);
    expect(store.activeExecution?.controller).toBe(controller);
    expect(store.settleExecution({
      controller: staleController,
      completedSuccessfully: true,
      errorMessage: null,
    })).toBe(false);
    expect(store.session?.execution.isLoading).toBe(true);

    expect(store.settleExecution({
      controller,
      completedSuccessfully: true,
      errorMessage: null,
    })).toBe(true);
    expect(store.session?.execution).toMatchObject({
      isLoading: false,
      isStreaming: false,
      completedSuccessfully: true,
      controller: null,
    });
    expect(store.activeExecution?.isLoading).toBe(false);
  });

  it('列引用状态只写入 active 会话', () => {
    const store = useTableAiModeStore();
    store.startSession(sessionInput());

    expect(store.updateActiveColumnRefs({
      A: {
        id: 'ref-A',
        color: '#000000',
        rect: { top: 0, bottom: 2, left: 0, right: 1 },
        active: true,
      },
    })).toBe(true);
    expect(store.activeContext?.activeColumnRefs.A?.id).toBe('ref-A');

    store.beginClosing('session-1');
    expect(store.updateActiveColumnRefs({})).toBe(false);
    expect(store.activeContext).toBeNull();
  });
});
