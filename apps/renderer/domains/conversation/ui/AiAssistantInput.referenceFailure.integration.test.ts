// @vitest-environment jsdom
/* eslint-disable vue/one-component-per-file -- 集成场景在此装配外围入口，输入组件与错误出口仍使用生产实现。 */
import { createApp, defineComponent, h, nextTick, reactive, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLocalizationRegistryForTest, registerMessageCatalogs } from '@app/localization';
import { useNavigationScope } from '@/app/navigation';
import { CONVERSATION_MESSAGE_CATALOG } from '../definitions/conversationMessageCatalog';
import { currentClientNoticeDraftKey, useClientNoticeStore } from '../features/client-notices';
import { clearConversationReferenceKindsForTest, registerConversationReferenceKind, useComposerReferences } from '../features/composer-references';
import ConversationChatSurface from './ConversationChatSurface.vue';

vi.mock('../assistantActions', () => ({ cancelAssistantActivity: vi.fn() }));

const boundary = vi.hoisted(() => ({ send: vi.fn(), legacyError: vi.fn() }));
const input = reactive({ conversationId: null as string | null, text: 'KEEP-DRAFT' });

// 保留真实输入/TipTap、引用 provider、notice 持久草稿及 Surface 出口；只替换外围能力。
vi.mock('../store/assistantStore', () => ({ useAssistantStore: () => ({
  get activeConversationId() { return input.conversationId; },
  get selectedConversationId() { return input.conversationId; },
  get inputText() { return input.text; },
  setInputText: (text: string) => { input.text = text; },
  activeConversation: null, activeMessages: [], isBusy: false, isLoading: false,
  isStreaming: false, isTimelineCollapsed: false, setError: boundary.legacyError,
}) }));
vi.mock('../store/conversationContentPhaseSelector', () => ({
  useConversationContentPhaseSelector: () => ref('draft'),
}));
vi.mock('../services/orchestration/chatFlowOrchestrator', () => ({
  useChatFlowOrchestrator: () => ({ sendChatMessage: boundary.send }),
}));
vi.mock('@/domains/model-configuration', () => ({
  modelAcceptsUserImageInput: () => true, shouldPromptForModelSetup: () => false,
  useModelCatalogReadModel: () => ({ models: ref([]), activeOperation: ref(null) }),
  useModelPickerReadModel: () => ({ snapshot: ref(null) }),
  useModelPurposeBindings: () => ({ effectivePrimaryModelId: ref(null) }),
}));
vi.mock('../features/model-selection/orchestration/useConversationModelSelection', () => ({
  useConversationModelSelection: () => ({ primaryModelValue: ref(null), modelSelectOptions: ref([]), selectPrimaryModelMenuValue: vi.fn() }),
}));
vi.mock('@/app/plugins/composables', () => ({ useConversationAgentChoices: () => ref([]) }));
vi.mock('../features/interactive-run', async () => ({
  ...await import('../features/interactive-run/functions/resolveComposerRunControl'),
  isInteractiveRunBusy: (await import('../features/interactive-run/functions/interactiveRunTransitions'))
    .isInteractiveRunBusy,
  useDetachedInteractiveRunObservation: vi.fn(),
  useInteractiveRunStore: () => ({ snapshotFor: () => undefined }),
}));
vi.mock('../features/client-notices/orchestration/clientNoticeApi', () => ({
  sendClientNotice: vi.fn(async () => { throw new Error('offline'); }),
}));
vi.mock('./AiAssistantInput/AiAssistantInputFooter.vue', () => ({
  default: defineComponent({
    props: { isPrimaryActionDisabled: Boolean }, emits: ['submit'],
    setup: (props, { emit }) => () => h('button', {
      class: 'test-send', disabled: props.isPrimaryActionDisabled, onClick: () => emit('submit'),
    }, '发送'),
  }),
}));
vi.mock('./ConversationHost.vue', () => ({ default: defineComponent({ render: () => h('div') }) }));

let unmount: (() => void) | undefined;
function mountComposer() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const navigation = useNavigationScope();
  navigation.startDraft({ kind: 'project', projectId: 'project-B' });
  const composer = useComposerReferences();
  composer.addReference({ pluginId: 'example', kind: 'selection', text: '旧引用正文', label: '源文档引用' });
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp(ConversationChatSurface, { emptyHeading: 'Linnya' });
  app.use(pinia);
  app.mount(container);
  unmount = () => { app.unmount(); container.remove(); };
  return { container, composer, navigation, notices: useClientNoticeStore() };
}
function submit(container: HTMLElement): void {
  const button = container.querySelector('.test-send');
  if (!(button instanceof HTMLButtonElement)) throw new Error('Missing send button');
  expect(button.disabled).toBe(false);
  button.click();
}
async function settle(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
  await nextTick();
}
function registerPreparation(prepareForSend: () => Promise<{ text: string }>): void {
  registerConversationReferenceKind({
    pluginId: 'example', kind: 'selection',
    chip: { label: () => '源文档引用', preview: () => '旧引用正文' }, prepareForSend,
  });
}
beforeEach(() => {
  localStorage.clear();
  boundary.send.mockReset(); boundary.legacyError.mockReset();
  input.conversationId = null; input.text = 'KEEP-DRAFT';
  registerMessageCatalogs(CONVERSATION_MESSAGE_CATALOG);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
});
afterEach(() => {
  unmount?.(); unmount = undefined;
  clearConversationReferenceKindsForTest(); clearLocalizationRegistryForTest();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe('reference preparation failure through the real composer', () => {
  it('waits for prepared references and sends their latest text through the existing chat boundary', async () => {
    let finishPreparation: ((value: { text: string }) => void) | undefined;
    registerPreparation(() => new Promise(resolve => { finishPreparation = resolve; }));
    const { container, composer, notices } = mountComposer();
    submit(container); await nextTick();
    expect(boundary.send).not.toHaveBeenCalled();
    finishPreparation?.({ text: '发送时的最新正文' });
    await settle();
    expect(boundary.send).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      text: 'KEEP-DRAFT', userQuote: expect.objectContaining({
        items: [expect.objectContaining({ text: '发送时的最新正文' })],
      }),
    }), {}, expect.anything());
    expect(notices.entries).toHaveLength(0);
    // 测试边界尚未给 user_input_committed，不能提前消耗草稿引用。
    expect(composer.references.value[0]?.text).toBe('旧引用正文');
    expect(input.text).toBe('KEEP-DRAFT');
  });

  it.each([null, 'conversation-A'])('keeps draft/references and displays a safe failure without sending (%s)', async conversationId => {
    input.conversationId = conversationId;
    registerPreparation(async () => { throw new Error('private-provider-response secret=do-not-display'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, composer, notices } = mountComposer();
    const originalReferences = JSON.stringify(composer.references.value);
    const draftKey = currentClientNoticeDraftKey();
    submit(container);
    await settle();
    expect(boundary.send).not.toHaveBeenCalled();
    expect(input.text).toBe('KEEP-DRAFT');
    expect(JSON.stringify(composer.references.value)).toBe(originalReferences);
    expect(container.querySelector('.input-editor')?.textContent).toContain('KEEP-DRAFT');
    expect(container.querySelector('.ai-assistant-quote-preview')?.textContent).toContain('旧引用正文');
    expect(container.querySelector('.client-notice')?.textContent?.trim()).toBe('引用读取失败，消息尚未发送。草稿和引用已保留，请检查引用后重试。');
    expect(notices.entries).toHaveLength(1);
    expect(notices.entries[0]).toMatchObject({ conversationId, draftKey, command: { reason_code: 'reference_preparation_failed', operation: 'send' } });
    expect(localStorage.getItem('conversation-client-notices-v1')).not.toContain('private-provider-response');
    expect(boundary.legacyError).not.toHaveBeenCalled();
    expect(container.querySelector('.test-send')?.hasAttribute('disabled')).toBe(false);
  });

  it('hides the original draft notice when switching projects and shows it only in its own scope', async () => {
    registerPreparation(async () => { throw new Error('denied'); });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { container, navigation } = mountComposer();
    submit(container); await settle();
    expect(container.querySelector('.client-notice')).not.toBeNull();
    navigation.enterProject('project-C'); await nextTick();
    expect(container.querySelector('.client-notice')).toBeNull();
    navigation.enterProject('project-B'); await nextTick();
    expect(container.querySelectorAll('.client-notice')).toHaveLength(1);
  });

  it.each(['conversation', 'project', 'draft'])('cancels pending preparation after switching %s and ignores late provider failure', async target => {
    let rejectPreparation: ((reason: Error) => void) | undefined;
    registerPreparation(() => new Promise((_resolve, reject) => { rejectPreparation = reject; }));
    const { container, navigation, notices } = mountComposer();
    submit(container); await nextTick();
    if (target === 'conversation') input.conversationId = 'conversation-B';
    else if (target === 'project') navigation.startDraft({ kind: 'project', projectId: 'project-C' });
    else {
      vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 100);
      navigation.startDraft();
    }
    input.text = 'NEW-DRAFT';
    await settle();
    expect(container.querySelector('.test-send')?.hasAttribute('disabled')).toBe(false);
    rejectPreparation?.(new Error('late private failure'));
    await settle();
    expect(boundary.send).not.toHaveBeenCalled();
    expect(notices.entries).toHaveLength(0);
    expect(container.querySelector('.client-notice')).toBeNull();
    expect(input.text).toBe('NEW-DRAFT');
    expect(boundary.legacyError).not.toHaveBeenCalled();
  });
});
