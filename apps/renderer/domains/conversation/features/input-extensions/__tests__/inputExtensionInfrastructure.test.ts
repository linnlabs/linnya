import { h, ref, shallowRef, type FunctionalComponent } from 'vue';
import { Extension, type AnyExtension } from '@tiptap/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ConversationInputContextBarProps,
  ConversationInputExtensionExecutionStatus,
  HostConversationInputExtension,
} from '../definitions/conversationInputExtensions';
import {
  clearConversationInputExtensionsForTest,
  registerConversationInputExtension,
  unregisterConversationInputExtension,
} from '../registration';
import {
  createRegisteredConversationInputEditorExtensions,
  useActiveConversationInputExtension,
  useConversationInputExecution,
} from '../orchestration/useConversationInputExtensions';
import { executeConversationInputExtensionSubmit } from '../orchestration/executeConversationInputExtensionSubmit';

const ContextBar: FunctionalComponent<ConversationInputContextBarProps> = () => h('div');

function createExtensionFixture(params: {
  id: string;
  active?: boolean;
  executionStatus?: ConversationInputExtensionExecutionStatus;
  acceptsReferences?: boolean;
  editorExtensions?: readonly {
    id: string;
    create: () => AnyExtension;
  }[];
}) {
  const isActive = ref(params.active ?? false);
  const executionStatus = ref<ConversationInputExtensionExecutionStatus>(
    params.executionStatus ?? 'idle',
  );
  const cancel = vi.fn();
  const submit = vi.fn();
  const extension: HostConversationInputExtension = {
    id: params.id,
    isActive,
    acceptsReferences: params.acceptsReferences ?? true,
    acceptsAttachments: false,
    contextBar: {
      component: ContextBar,
      payload: shallowRef<unknown>(null),
    },
    editorExtensions: params.editorExtensions ?? [],
    onSubmit: submit,
    onDeactivate: vi.fn(),
    executionState: {
      status: executionStatus,
      cancel,
    },
  };
  return { extension, isActive, executionStatus, cancel, submit };
}

describe('conversation input extension infrastructure', () => {
  afterEach(() => {
    clearConversationInputExtensionsForTest();
  });

  it('空注册表保持普通 chat 执行态和取消语义不变', () => {
    const chatLoading = ref(false);
    const chatStreaming = ref(false);
    const cancelChat = vi.fn();
    const execution = useConversationInputExecution({
      isLoading: () => chatLoading.value,
      isStreaming: () => chatStreaming.value,
      cancel: cancelChat,
    });

    expect(execution.activeExtension.value).toBeNull();
    expect(execution.isLoading.value).toBe(false);
    expect(execution.isStreaming.value).toBe(false);

    chatLoading.value = true;
    chatStreaming.value = true;
    expect(execution.isLoading.value).toBe(true);
    expect(execution.isStreaming.value).toBe(true);

    execution.cancel();
    expect(cancelChat).toHaveBeenCalledOnce();
  });

  it('按扩展自报 selector 解析唯一 active，并由运行扩展接管执行态和停止动作', () => {
    const first = createExtensionFixture({ id: 'first' });
    const second = createExtensionFixture({ id: 'second', active: true });
    registerConversationInputExtension(first.extension);
    registerConversationInputExtension(second.extension);

    const cancelChat = vi.fn();
    const execution = useConversationInputExecution({
      isLoading: () => false,
      isStreaming: () => false,
      cancel: cancelChat,
    });

    expect(execution.activeExtension.value?.id).toBe('second');
    expect(execution.isLoading.value).toBe(false);

    second.executionStatus.value = 'running';
    expect(execution.isLoading.value).toBe(true);
    expect(execution.isStreaming.value).toBe(true);
    execution.cancel();
    expect(second.cancel).toHaveBeenCalledOnce();
    expect(cancelChat).not.toHaveBeenCalled();

    second.isActive.value = false;
    first.isActive.value = true;
    expect(execution.activeExtension.value?.id).toBe('first');
  });

  it('把重复注册和多个 active 视为显式契约错误', () => {
    const first = createExtensionFixture({ id: 'duplicate', active: true });
    const duplicate = createExtensionFixture({ id: 'duplicate' });
    const secondActive = createExtensionFixture({ id: 'second-active', active: true });
    registerConversationInputExtension(first.extension);

    expect(() => registerConversationInputExtension(duplicate.extension))
      .toThrow('输入扩展重复注册: duplicate');

    registerConversationInputExtension(secondActive.extension);
    const activeExtension = useActiveConversationInputExtension();
    expect(() => activeExtension.value)
      .toThrow('同时激活了多个输入扩展: duplicate, second-active');

    expect(unregisterConversationInputExtension('second-active')).toBe(true);
    expect(activeExtension.value?.id).toBe('duplicate');
  });

  it('构造期合并全部静态 editor extensions，并在 factory 执行前拒绝重复 descriptor id', () => {
    const firstEditorExtension = Extension.create({ name: 'firstComposerExtension' });
    const secondEditorExtension = Extension.create({ name: 'secondComposerExtension' });
    const createFirst = vi.fn(() => firstEditorExtension);
    const createSecond = vi.fn(() => secondEditorExtension);
    registerConversationInputExtension(createExtensionFixture({
      id: 'first',
      editorExtensions: [{ id: 'first-editor-extension', create: createFirst }],
    }).extension);
    registerConversationInputExtension(createExtensionFixture({
      id: 'second',
      editorExtensions: [{ id: 'second-editor-extension', create: createSecond }],
    }).extension);

    expect(createRegisteredConversationInputEditorExtensions()).toEqual([
      firstEditorExtension,
      secondEditorExtension,
    ]);
    expect(createFirst).toHaveBeenCalledOnce();
    expect(createSecond).toHaveBeenCalledOnce();

    clearConversationInputExtensionsForTest();
    const duplicateFactory = vi.fn(() => firstEditorExtension);
    registerConversationInputExtension(createExtensionFixture({
      id: 'duplicate-descriptor-a',
      editorExtensions: [{ id: 'same-editor-extension', create: duplicateFactory }],
    }).extension);
    registerConversationInputExtension(createExtensionFixture({
      id: 'duplicate-descriptor-b',
      editorExtensions: [{ id: 'same-editor-extension', create: duplicateFactory }],
    }).extension);

    expect(() => createRegisteredConversationInputEditorExtensions())
      .toThrow('editor extension 重复注册: same-editor-extension');
    expect(duplicateFactory).not.toHaveBeenCalled();
  });

  it('扩展同步快照后立即清空 draft，并等待异步提交结束', async () => {
    const fixture = createExtensionFixture({ id: 'submit-order' });
    const events: string[] = [];
    fixture.submit.mockImplementation(() => {
      events.push('submit-started');
      return Promise.resolve().then(() => events.push('submit-settled'));
    });

    await executeConversationInputExtensionSubmit({
      extension: fixture.extension,
      payload: { text: 'prompt', references: [] },
      clearDraftAfterStart: () => events.push('draft-cleared'),
    });

    expect(events).toEqual(['submit-started', 'draft-cleared', 'submit-settled']);
  });

  it('扩展同步启动失败时仍清空已经提交的 draft', async () => {
    const fixture = createExtensionFixture({ id: 'submit-failure' });
    const clearDraft = vi.fn();
    fixture.submit.mockImplementation(() => {
      throw new Error('submit failed');
    });

    await expect(executeConversationInputExtensionSubmit({
      extension: fixture.extension,
      payload: { text: 'prompt', references: [] },
      clearDraftAfterStart: clearDraft,
    })).rejects.toThrow('submit failed');
    expect(clearDraft).toHaveBeenCalledOnce();
  });
});
