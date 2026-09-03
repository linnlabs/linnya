import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  type ConversationInputComposerHandles,
  executeConversationInputExtensionSubmit,
} from '@/domains/conversation/features/input-extensions';
import { useTableAiModeStore } from '@/domains/editor/features/table-ai-mode';
import type { TableFillWorkflow } from '../definitions/tableFillWorkflow';
import { createTableFillComposerPort } from '../functions/createTableFillComposerPort';
import {
  createTableFillConversationInputExtension,
  TABLE_FILL_COLUMN_REFERENCE_EDITOR_EXTENSION_ID,
  TABLE_FILL_CONVERSATION_INPUT_EXTENSION_ID,
} from '../orchestration/createTableFillConversationInputExtension';

function startTableMode(): void {
  useTableAiModeStore().startSession({
    sessionId: 'table-session-1',
    table: {
      editorId: 'editor-1',
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
      outputColumnAdded: false,
    },
  });
}

function createWorkflowFixture() {
  const submit = vi.fn(async () => {});
  const cancel = vi.fn();
  const deactivate = vi.fn(async () => {});
  const workflow: TableFillWorkflow = { submit, cancel, deactivate };
  return { workflow, submit, cancel, deactivate };
}

describe('table fill conversation input extension', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('把 table 模式、输入同步、执行态和 workflow 委托收口为一个扩展', async () => {
    const { workflow, submit, cancel, deactivate } = createWorkflowFixture();
    const extension = createTableFillConversationInputExtension(workflow);
    const store = useTableAiModeStore();

    expect(extension.id).toBe(TABLE_FILL_CONVERSATION_INPUT_EXTENSION_ID);
    expect(extension.acceptsAttachments).toBe(false);
    expect(extension.isActive.value).toBe(false);
    expect(extension.acceptsReferences).toBe(false);
    expect(extension.executionState.status.value).toBe('idle');
    expect(extension.editorExtensions.map(descriptor => descriptor.id)).toEqual([
      TABLE_FILL_COLUMN_REFERENCE_EDITOR_EXTENSION_ID,
    ]);
    expect(extension.editorExtensions[0]?.create().name).toBe('columnReference');

    startTableMode();
    expect(extension.isActive.value).toBe(true);

    extension.onTextChange?.('根据 {{A}} 生成内容');
    expect(Object.keys(store.activeContext?.activeColumnRefs ?? {})).toEqual(['A']);

    await extension.onSubmit({ text: '生成摘要', references: [] });
    expect(submit).toHaveBeenCalledExactlyOnceWith('生成摘要');

    const controller = new AbortController();
    store.beginExecution(controller);
    expect(extension.executionState.status.value).toBe('running');
    extension.executionState.cancel();
    expect(cancel).toHaveBeenCalledOnce();

    store.settleExecution({
      controller,
      completedSuccessfully: true,
      errorMessage: null,
    });
    expect(extension.executionState.status.value).toBe('idle');

    await extension.onDeactivate();
    expect(deactivate).toHaveBeenCalledOnce();
  });

  it('把列引用转换成当前 composer 实例的通用 inline token', () => {
    const composer: ConversationInputComposerHandles = {
      insertInlineToken: vi.fn(() => true),
    };
    const tableComposer = createTableFillComposerPort(composer);

    expect(tableComposer.insertColumnReference({
      refKey: 'A',
      label: '{{A}}',
      color: '#123456',
    })).toBe(true);
    expect(composer.insertInlineToken).toHaveBeenCalledExactlyOnceWith({
      type: 'columnReference',
      attributes: {
        refKey: 'A',
        label: '{{A}}',
        color: '#123456',
      },
    });
  });

  it('提交先快照 active refs，再允许宿主清空 composer 文本', async () => {
    const fixture = createWorkflowFixture();
    const store = useTableAiModeStore();
    const capturedReferenceKeys: string[][] = [];
    fixture.submit.mockImplementation(async () => {
      capturedReferenceKeys.push(Object.keys(store.activeContext?.activeColumnRefs ?? {}));
    });
    const extension = createTableFillConversationInputExtension(fixture.workflow);
    startTableMode();
    extension.onTextChange?.('根据 {{A}} 生成内容');

    await executeConversationInputExtensionSubmit({
      extension,
      payload: { text: '根据 {{A}} 生成内容', references: [] },
      clearDraftAfterStart: () => extension.onTextChange?.(''),
    });

    expect(capturedReferenceKeys).toEqual([['A']]);
    expect(store.activeContext?.activeColumnRefs).toEqual({});
  });
});
