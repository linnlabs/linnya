import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type { StartTableAiModeSessionInput } from '../definitions/tableAiMode';
import { useTableAiModeStore } from '../store/tableAiModeStore';
import { tableAiHighlightRuntime } from './tableAiHighlightRuntime';
import {
  updateTableAiColumnReferencesFromText,
  validateAndActivateTableAiColumnReference,
} from './tableAiColumnReferenceRuntime';

function sessionInput(sessionId: string): StartTableAiModeSessionInput {
  return {
    sessionId,
    table: {
      editorId: 'main',
      rootBlockId: 'root-1',
      lastKnownPos: 10,
    },
    context: {
      columnRefs: [
        {
          name: 'A',
          reference: 'A',
          range: 'A',
          rect: { top: 0, bottom: 2, left: 0, right: 1 },
        },
        {
          name: 'B',
          reference: 'B',
          range: 'B',
          rect: { top: 0, bottom: 2, left: 1, right: 2 },
        },
      ],
      selectionRange: 'A1:B2',
      outputColumnRange: 'C1:C2',
      activeColumnRefs: {},
      outputRect: { top: 0, bottom: 2, left: 2, right: 3 },
      outputColumnAdded: false,
    },
  };
}

describe('tableAiColumnReferenceRuntime', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('从输入文本更新当前会话的列引用状态', () => {
    const store = useTableAiModeStore();
    store.startSession(sessionInput('session-1'));

    updateTableAiColumnReferencesFromText('根据 {{A}} 和 {{B}} 生成内容，忽略 {{missing}}');

    const refs = store.activeContext?.activeColumnRefs ?? {};
    expect(Object.keys(refs)).toEqual(['A', 'B']);
    expect(refs.A?.color).not.toBe(refs.B?.color);
  });

  it('InputRule 延迟事件携带创建它的 sessionId', () => {
    vi.useFakeTimers();
    const store = useTableAiModeStore();
    const applyHighlights = vi.spyOn(tableAiHighlightRuntime, 'applyColumnReferenceHighlights');

    store.startSession(sessionInput('session-1'));
    expect(validateAndActivateTableAiColumnReference('A')).not.toBeNull();
    store.beginClosing('session-1');
    store.completeClosing('session-1');
    store.startSession(sessionInput('session-2'));

    vi.runAllTimers();

    expect(applyHighlights).toHaveBeenCalledOnce();
    expect(applyHighlights.mock.calls[0]?.[0].sessionId).toBe('session-1');
    expect(store.session?.sessionId).toBe('session-2');
  });
});
