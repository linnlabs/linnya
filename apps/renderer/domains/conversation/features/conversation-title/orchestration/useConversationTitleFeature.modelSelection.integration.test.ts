import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setAuxiliaryModelPurposeBinding,
  setModelPurposeBinding,
  startModelCatalogLifecycle,
  stopModelCatalogLifecycle,
  type ModelCatalogItem,
} from '@/domains/model-configuration';
import { useConversationTitleCandidateStore } from '../store/conversationTitleCandidateStore';
import { useConversationTitleFeature } from './useConversationTitleFeature';

const harness = vi.hoisted(() => ({
  apiFetch: vi.fn<(url: string, init: { body: string }) => Promise<Response>>(),
  titleResponse: vi.fn<() => Promise<Response>>(),
  catalogModels: [] as unknown[],
  updateTitle: vi.fn<(conversationId: string, title: string) => Promise<boolean>>(),
  updateConversationTitle: vi.fn(),
  updateHistoryConversation: vi.fn(),
}));

vi.mock('@shared/services/localApiClient', () => ({
  apiFetch: harness.apiFetch,
  getApiBaseUrl: async () => 'http://fixture.local',
}));

vi.mock('../../../history/services/historyApiService', () => ({
  historyApiService: { updateTitle: harness.updateTitle },
}));

vi.mock('../../../store/conversationState', () => ({
  useConversationState: () => ({ updateConversationTitle: harness.updateConversationTitle }),
}));

vi.mock('../../../history/list', () => ({
  useHistoryList: () => ({ updateConversation: harness.updateHistoryConversation }),
}));

const CONVERSATION_ID = 'conversation-1';

function chatModel(id: string): ModelCatalogItem {
  return { id, catalog_source: 'user', capabilities: ['chat'], ui_visibility: ['chat'] };
}

function reasoningModel(id: string, efforts: ModelCatalogItem['reasoning']): ModelCatalogItem {
  return { ...chatModel(id), reasoning: efforts };
}

/** 通过真实目录生命周期接纳模型，避免测试直接写目录 store。 */
async function loadCatalog(models: readonly ModelCatalogItem[]): Promise<void> {
  harness.catalogModels = [...models];
  await startModelCatalogLifecycle();
}

function titleResponse(title: string): Response {
  return new Response(
    `event: final_answer\ndata: ${JSON.stringify({ type: 'final_answer', content: title })}\n\n`
  );
}

function titleRequests(): readonly [string, { body: string }][] {
  return harness.apiFetch.mock.calls.filter(([url]) => url.endsWith('/api/v1/conversation/next'));
}

function lastRequestOptions(): Record<string, unknown> {
  const requests = titleRequests();
  const call = requests[requests.length - 1];
  if (!call) throw new Error('没有发出标题模型请求');
  return JSON.parse(call[1].body).options as Record<string, unknown>;
}

async function submitFirstMessage(): Promise<void> {
  const title = useConversationTitleFeature();
  title.registerAutomaticCandidate(CONVERSATION_ID);
  await title.handleUserMessage({ conversationId: CONVERSATION_ID, userText: '帮我规划一次东京旅行' });
  // 模型标题在 fallback 写入之后排队，等待生成与写入队列清空。
  await vi.waitFor(() => {
    expect(useConversationTitleCandidateStore().getCandidate(CONVERSATION_ID)).toBeNull();
  });
}

describe('对话标题的模型选择', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.stubGlobal('window', { electronAPI: { on: vi.fn(() => vi.fn()) } });
    harness.catalogModels = [];
    harness.titleResponse.mockReset();
    harness.apiFetch.mockReset().mockImplementation(async (url) => (
      url.endsWith('/api/v1/models')
        ? Response.json({
          models: harness.catalogModels,
          task_defaults: {},
          cloud_models_ready: false,
        })
        : harness.titleResponse()
    ));
    harness.updateTitle.mockReset().mockResolvedValue(true);
    harness.updateConversationTitle.mockReset();
    harness.updateHistoryConversation.mockReset();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    stopModelCatalogLifecycle();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('没有选择标题模型时使用主模型生成标题', async () => {
    await loadCatalog([chatModel('main'), chatModel('title-flash')]);
    setModelPurposeBinding('primary', 'main');
    harness.titleResponse.mockResolvedValue(titleResponse('东京旅行规划'));

    await submitFirstMessage();

    expect(titleRequests()).toHaveLength(1);
    expect(lastRequestOptions()).toMatchObject({ promptKey: 'conversation_title', model_id: 'main' });
    expect(harness.updateTitle).toHaveBeenLastCalledWith(CONVERSATION_ID, '东京旅行规划');
  });

  it('用户选择了标题模型时，以所选模型为准', async () => {
    await loadCatalog([chatModel('main'), chatModel('title-flash')]);
    setModelPurposeBinding('primary', 'main');
    setAuxiliaryModelPurposeBinding('conversation_title', 'title-flash');
    harness.titleResponse.mockResolvedValue(titleResponse('东京旅行规划'));

    await submitFirstMessage();

    expect(lastRequestOptions()).toMatchObject({ model_id: 'title-flash' });
  });

  it('标题请求使用标题模型支持的最弱思考档，有关闭档时关闭思考', async () => {
    await loadCatalog([
      reasoningModel('main', { supported_efforts: ['high', 'off', 'low'], default_effort: 'high' }),
    ]);
    setModelPurposeBinding('primary', 'main');
    harness.titleResponse.mockResolvedValue(titleResponse('东京旅行规划'));

    await submitFirstMessage();

    expect(lastRequestOptions()).toMatchObject({ model_id: 'main', reasoning_effort: 'off' });
  });

  it('用户所选标题模型没有关闭档时用它的最低档，不沿用主模型档位', async () => {
    await loadCatalog([
      reasoningModel('main', { supported_efforts: ['off', 'high'], default_effort: 'high' }),
      reasoningModel('title-flash', { supported_efforts: ['high', 'medium'], default_effort: 'high' }),
    ]);
    setModelPurposeBinding('primary', 'main');
    setAuxiliaryModelPurposeBinding('conversation_title', 'title-flash');
    harness.titleResponse.mockResolvedValue(titleResponse('东京旅行规划'));

    await submitFirstMessage();

    expect(lastRequestOptions()).toMatchObject({ model_id: 'title-flash', reasoning_effort: 'medium' });
  });

  it('标题模型不声明思考档时不额外指定标题档位', async () => {
    await loadCatalog([chatModel('main')]);
    setModelPurposeBinding('primary', 'main');
    harness.titleResponse.mockResolvedValue(titleResponse('东京旅行规划'));

    await submitFirstMessage();

    expect(lastRequestOptions()).not.toHaveProperty('reasoning_effort');
  });

  it('标题模型和主模型都不可用时只发一次请求，失败后保留首问标题且不重试', async () => {
    await loadCatalog([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    harness.titleResponse.mockResolvedValue(new Response('no model', { status: 400 }));

    await submitFirstMessage();

    expect(titleRequests()).toHaveLength(1);
    expect(lastRequestOptions()).not.toHaveProperty('model_id');
    expect(harness.updateTitle).toHaveBeenCalledTimes(1);
    expect(harness.updateTitle).toHaveBeenCalledWith(CONVERSATION_ID, '帮我规划一次东京旅行');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
