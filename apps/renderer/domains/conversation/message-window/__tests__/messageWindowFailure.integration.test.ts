// @vitest-environment jsdom
import { createApp, h, nextTick, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLocalizationRegistryForTest, registerMessageCatalogs } from '@app/localization';
import { CONVERSATION_MESSAGE_CATALOG } from '../../definitions/conversationMessageCatalog';
import { useClientNoticeStore } from '../../features/client-notices';
import type { MessageWindowFailure } from '../definitions/messageWindow';
import type { UiMessagesWindowReadyDto } from '../definitions/uiMessagesDto';
import { loadAfter, loadAround, loadBefore, loadTail } from '../orchestration/messageWindowLoader';
import { useMessageWindowStore } from '../store/messageWindowStore';
import MessageWindowError from '../ui/MessageWindowError.vue';

const network = vi.hoisted(() => ({ fetch: vi.fn<() => Promise<Response>>() }));
vi.mock('@shared/services/aiService/common', () => ({
  getApiBaseUrl: async () => 'http://localhost.test',
  apiFetch: network.fetch,
}));

function readyWindow(conversationId = 'conversation-load'): UiMessagesWindowReadyDto {
  return {
    success: true, conversation_id: conversationId, messages: [], latest_context_usage: null,
    has_more_before: false, has_more_after: false, revision: 1, citation_dependencies: {},
  };
}

const deps = { readLiveMessages: () => [] };

describe('current conversation window failure lifecycle', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
    registerMessageCatalogs(CONVERSATION_MESSAGE_CATALOG);
    network.fetch.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    clearLocalizationRegistryForTest();
  });

  it.each<{
    scenario: string;
    respond: () => Promise<Response>;
    stage: string;
    failure: MessageWindowFailure;
  }>([
    {
      scenario: 'network disconnected',
      respond: async () => { throw new TypeError('PRIVATE network detail'); },
      stage: 'request', failure: { error_kind: 'connection' },
    },
    {
      scenario: 'HTTP error with a non-JSON body',
      respond: async () => new Response('<html>PRIVATE service detail</html>', { status: 503 }),
      stage: 'http', failure: { error_kind: 'http', http_status: 503 },
    },
    {
      scenario: 'invalid JSON in a successful response',
      respond: async () => new Response('PRIVATE broken JSON', { status: 200 }),
      stage: 'response-json', failure: { error_kind: 'projection' },
    },
    {
      scenario: 'invalid window DTO',
      respond: async () => Response.json({ ...readyWindow(), messages: [{ content: 'PRIVATE message' }] }),
      stage: 'response-contract', failure: { error_kind: 'projection' },
    },
  ])('$scenario stays transient and retains diagnostic context', async ({ respond, stage, failure }) => {
    network.fetch.mockImplementationOnce(respond);
    const store = useMessageWindowStore();
    await expect(loadTail('conversation-load', {}, deps)).rejects.toThrow();
    expect(store.error).toEqual(failure);
    expect(store.status).toBe('error');
    expect(useClientNoticeStore().entries).toHaveLength(0);
    expect(console.error).toHaveBeenCalledWith('[MessageWindowLoader] Window load failed', expect.objectContaining({
      conversationId: 'conversation-load', mode: 'tail', stage, retainedRowCount: 0,
    }));
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('PRIVATE');

    network.fetch.mockResolvedValueOnce(Response.json(readyWindow()));
    await loadTail('conversation-load', {}, deps);
    expect(store.status).toBe('ready');
    expect(store.error).toBeNull();
    expect(useClientNoticeStore().entries).toHaveLength(0);
    expect(localStorage.getItem('conversation-client-notices-v1') ?? '').not.toContain('load');
  });

  it.each(['before', 'after', 'around'] as const)('%s failure clears after a successful navigation to another conversation', async mode => {
    network.fetch.mockResolvedValueOnce(Response.json(readyWindow()));
    await loadTail('conversation-load', {}, deps);
    network.fetch.mockResolvedValueOnce(new Response(null, { status: 504 }));
    const load = mode === 'before' ? loadBefore('conversation-load', 10, {}, deps)
      : mode === 'after' ? loadAfter('conversation-load', 10, {}, deps)
        : loadAround('conversation-load', 'message-10', {}, deps);
    await expect(load).rejects.toThrow();
    expect(useMessageWindowStore().error).toEqual({ error_kind: 'http', http_status: 504 });
    network.fetch.mockResolvedValueOnce(Response.json(readyWindow('conversation-next')));
    await loadTail('conversation-next', {}, deps);
    expect(useMessageWindowStore().error).toBeNull();
    expect(useClientNoticeStore().entries).toHaveLength(0);
  });

  it('does not display the previous conversation failure while selection changes', async () => {
    const conversationId = ref('conversation-load');
    const container = document.createElement('div');
    const app = createApp({ render: () => h(MessageWindowError, { conversationId: conversationId.value }) });
    app.mount(container);
    useMessageWindowStore().setError('conversation-load', { error_kind: 'unknown' });
    await nextTick();
    expect(container.textContent?.trim()).toBe('加载对话失败，请稍后重试。');
    conversationId.value = 'conversation-next';
    await nextTick();
    expect(container.querySelector('.message-window-error')).toBeNull();
    app.unmount();
  });

  it('keeps projection rebuilding as preparing, without a failure notice', async () => {
    network.fetch.mockResolvedValueOnce(Response.json({
      success: false, status: 'preparing', conversation_id: 'conversation-load',
    }, { status: 409 }));
    await loadTail('conversation-load', {}, deps);
    expect(useMessageWindowStore().status).toBe('preparing');
    expect(useMessageWindowStore().error).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
    expect(useClientNoticeStore().entries).toHaveLength(0);
  });
});
