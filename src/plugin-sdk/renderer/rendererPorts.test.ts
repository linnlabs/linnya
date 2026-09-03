import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ref } from 'vue';

import {
  clearRendererInteractiveToolPortForTest,
  concludeInteractiveToolInteraction,
  registerRendererInteractiveToolPort,
} from './interactiveTool';
import {
  clearRendererDocumentMutationHandlersForTest,
  notifyRendererDocumentMutationHandlers,
  registerRendererDocumentMutationHandler,
} from './documentMutationPort';
import {
  clearRendererReferenceRuntimePortForTest,
  listKnowledgeBasesForPlugin,
  registerRendererReferenceRuntimePort,
  searchInMultipleKbs,
  useWebManualCitationForm,
  validateWebManualForm,
  type WebManualFormInput,
} from './referenceRuntime';
import {
  clearRendererToolRefreshHandlersForTest,
  registerRendererToolRefreshHandler,
  useRegisteredRendererToolRefreshTriggers,
} from './toolRefreshPort';
import {
  addComposerReference,
  clearRendererComposerCommandPortForTest,
  registerRendererComposerCommandPort,
  removeComposerReference,
} from './composerCommandPort';
import {
  clearRendererConversationSubrunInvocationPortForTest,
  registerRendererConversationSubrunInvocationPort,
  startConversationSubruns,
} from './conversationSubrunInvocationPort';

function createWebManualForm(): WebManualFormInput {
  return {
    url: '',
    title: '',
    authors: '',
    date: '',
    containerTitle: '',
    snippet: '',
    isManual: false,
  };
}

describe('renderer SDK ports', () => {
  beforeEach(() => {
    clearRendererInteractiveToolPortForTest();
    clearRendererDocumentMutationHandlersForTest();
    clearRendererReferenceRuntimePortForTest();
    clearRendererToolRefreshHandlersForTest();
    clearRendererComposerCommandPortForTest();
    clearRendererConversationSubrunInvocationPortForTest();
  });

  it('fails fast when composer command port is not registered', () => {
    expect(() => addComposerReference({
      text: 'Node A',
      pluginId: 'fixture-plugin',
      kind: 'node',
    })).toThrow(/composer command port 尚未注册/);
  });

  it('forwards composer reference commands and returns the generated reference id', () => {
    const addReference = vi.fn(() => 'reference-1');
    const removeReference = vi.fn();
    registerRendererComposerCommandPort({ addReference, removeReference });

    const input = {
      text: 'Node A',
      pluginId: 'fixture-plugin',
      kind: 'node',
      uri: 'linnya://fixture-plugin/document-1#node/node-a',
    };
    expect(addComposerReference(input)).toBe('reference-1');
    removeComposerReference('reference-1');

    expect(addReference).toHaveBeenCalledWith(input);
    expect(removeReference).toHaveBeenCalledWith('reference-1');
  });

  it('rejects duplicate composer command port registration', () => {
    const port = {
      addReference: vi.fn(() => 'reference-1'),
      removeReference: vi.fn(),
    };
    registerRendererComposerCommandPort(port);

    expect(() => registerRendererComposerCommandPort(port)).toThrow(/重复注册/);
  });

  it('forwards conversation subrun invocations and returns the run handle', async () => {
    const completion = Promise.resolve();
    const handle = { runId: 'run-1', completion, cancel: vi.fn() };
    const start = vi.fn(() => handle);
    registerRendererConversationSubrunInvocationPort({ start });
    const request = {
      pluginId: 'fixture-plugin',
      workerId: 'item-research',
      prompt: 'Research selected items',
      activityFeature: 'fixture_research',
      subruns: [{ description: 'Node A', prompt: 'Research Node A' }],
    };

    expect(startConversationSubruns(request)).toBe(handle);
    expect(start).toHaveBeenCalledWith(request);
    await completion;
  });

  it('fails fast when interactive tool port is not registered', () => {
    expect(() => concludeInteractiveToolInteraction({
      observation: 'approved',
      toolCallId: 'tool-call-1',
      toolName: 'ppt_plan',
      data: { ok: true },
      interactionResponse: { status: 'approved' },
    })).toThrow(/interactive tool port 尚未注册/);
  });

  it('forwards interactive tool completion through the registered port', async () => {
    const conclude = vi.fn(async () => undefined);
    registerRendererInteractiveToolPort({
      concludeInteractiveToolInteraction: conclude,
    });

    await concludeInteractiveToolInteraction({
      observation: 'approved',
      toolCallId: 'tool-call-1',
      toolName: 'ppt_plan',
      data: { ok: true },
      interactionResponse: {
        status: 'approved',
        response: { ok: true },
      },
    });

    expect(conclude).toHaveBeenCalledWith({
      observation: 'approved',
      toolCallId: 'tool-call-1',
      toolName: 'ppt_plan',
      data: { ok: true },
      interactionResponse: {
        status: 'approved',
        response: { ok: true },
      },
    });
  });

  it('fails fast when reference runtime port is not registered', async () => {
    await expect(listKnowledgeBasesForPlugin()).rejects.toThrow(/reference runtime port 尚未注册/);
    expect(() => validateWebManualForm(createWebManualForm())).toThrow(/reference runtime port 尚未注册/);
  });

  it('forwards reference runtime operations through the registered port', async () => {
    const search = vi.fn(async () => ({
      results: [],
      errorsByKbId: {},
      hasPartialFailure: false,
    }));
    const validate = vi.fn(() => ({ title: '标题不能为空' }));
    const listKnowledgeBases = vi.fn(async () => [{ id: 'kb-1', name: 'KB' }]);
    const useForm = vi.fn(() => ({
      sourceType: ref<'web' | 'manual'>('web'),
      urlInputRef: ref<HTMLInputElement | null>(null),
      titleInputRef: ref<HTMLInputElement | null>(null),
      snippetTextareaRef: ref<HTMLTextAreaElement | null>(null),
      handleSourceTypeChange: vi.fn(),
      handleFieldChange: vi.fn(),
      handleSnippetInput: vi.fn(),
      handleReset: vi.fn(),
    }));
    registerRendererReferenceRuntimePort({
      searchInMultipleKbs: search,
      validateWebManualForm: validate,
      listKnowledgeBasesForPlugin: listKnowledgeBases,
      useWebManualCitationForm: useForm,
    });

    const form = createWebManualForm();
    await searchInMultipleKbs({
      kbIds: ['kb-1'],
      kbIdToName: { 'kb-1': 'KB' },
      query: 'topic',
    });
    expect(validateWebManualForm(form)).toEqual({ title: '标题不能为空' });
    expect(await listKnowledgeBasesForPlugin()).toEqual([{ id: 'kb-1', name: 'KB' }]);
    useWebManualCitationForm({
      visible: true,
      activeTab: 'web',
      webManualForm: form,
      updateWebManualForm: vi.fn(),
      setWebManualError: vi.fn(),
      resetWebManualForm: vi.fn(),
    });

    expect(search).toHaveBeenCalledWith({
      kbIds: ['kb-1'],
      kbIdToName: { 'kb-1': 'KB' },
      query: 'topic',
    });
    expect(validate).toHaveBeenCalledWith(form);
    expect(listKnowledgeBases).toHaveBeenCalled();
    expect(useForm).toHaveBeenCalled();
  });

  it('installs every renderer tool refresh trigger so each handler can react to later tool name updates', () => {
    const firstTrigger = vi.fn();
    const secondTrigger = vi.fn();

    registerRendererToolRefreshHandler({
      id: 'fixture-plugin-a',
      shouldHandle: (toolName) => toolName === 'fixture_create_node',
      useTrigger: firstTrigger,
    });
    registerRendererToolRefreshHandler({
      id: 'fixture-plugin',
      shouldHandle: (toolName) => toolName === 'write_file',
      useTrigger: secondTrigger,
    });

    const params = {
      toolName: ref('Unknown Tool'),
      toolArgs: ref({}),
      toolResult: ref({}),
      status: ref('loading'),
      messageId: ref('msg-1'),
      conversationId: ref('conversation-1'),
    };

    useRegisteredRendererToolRefreshTriggers(params);

    expect(firstTrigger).toHaveBeenCalledWith(params);
    expect(secondTrigger).toHaveBeenCalledWith(params);
  });

  it('dispatches document mutations to matching renderer handlers only', async () => {
    const firstHandler = vi.fn(async () => undefined);
    const secondHandler = vi.fn(async () => undefined);
    registerRendererDocumentMutationHandler({
      id: 'fixture-plugin-a',
      nodeType: 'fixture-document-a',
      activeDocumentType: 'fixture-editor-a',
      handleMutation: firstHandler,
    });
    registerRendererDocumentMutationHandler({
      id: 'fixture-plugin-b',
      nodeType: 'fixture-document-b',
      activeDocumentType: 'fixture-editor-b',
      handleMutation: secondHandler,
    });

    await notifyRendererDocumentMutationHandlers({
      mutationId: 'mutation-1',
      projectId: 'project-1',
      documentId: 'document-1',
      nodeType: 'fixture-document-a',
      activeDocumentType: 'fixture-editor-a',
      mutationKind: 'version',
      versionNumber: 2,
    });

    expect(firstHandler).toHaveBeenCalledTimes(1);
    expect(firstHandler).toHaveBeenCalledWith({
      mutationId: 'mutation-1',
      projectId: 'project-1',
      documentId: 'document-1',
      nodeType: 'fixture-document-a',
      activeDocumentType: 'fixture-editor-a',
      mutationKind: 'version',
      versionNumber: 2,
    });
    expect(secondHandler).not.toHaveBeenCalled();
  });
});
