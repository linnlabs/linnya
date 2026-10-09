// @vitest-environment jsdom

import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { createApp, defineComponent, h, nextTick, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_GENERATION_TOOL_ERROR_CODES, type SubrunTraceSummary } from '@app/schemas';
import { clearRendererPluginRegistryForTest, registerRendererPlugin } from '@/app/plugins/registry';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { createToolPresentationProjectionPort } from '@/app/plugins/orchestration/createToolPresentationProjectionPort';
import { registerWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { useUIStore } from '@/shared/stores/ui';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../definitions/conversationRenderScope';
import { createTestToolMessage } from '../../../testing/functions/createConversationTestMessage';
import type { ToolCallMessage } from '../../../types';
import ToolCallsMessage from '../../../ui/message/ToolCallsMessage.vue';
import { commonToolConfigs } from '../../../ui/tools/configs/common';
import { loadCompleteSubrunTrace } from '../../subrun-trace/orchestration/loadSubrunTrace';

// 消息外壳会导入 Workspace gateway；本测试只通过导航 port，不启动 Electron。
vi.mock('@/shared/ipc/workspaceGateway', () => ({ workspaceGateway: {} }));

vi.mock('../../subrun-trace/orchestration/loadSubrunTrace', async loadOriginal => ({
  ...await loadOriginal<typeof import('../../subrun-trace/orchestration/loadSubrunTrace')>(),
  loadCompleteSubrunTrace: vi.fn(async () => ({
    status: 'ready' as const, buckets: {}, eventCount: 0, nextCursor: null, revision: 1,
  })),
}));

const reason = '引用格式不合法："[@source；document]"。';
const children = ['investigation', 'investigation-review', 'draft', 'argument-review', 'source-review', 'revision'];
let app: App | undefined;
let pinia: Pinia;
let genericCardMounted = false;

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index += 1) { await Promise.resolve(); await nextTick(); }
}
function failedMessage(toolName: string, errorCode?: string): ToolCallMessage {
  const subrunSummary: SubrunTraceSummary | undefined = toolName === 'research_run' ? {
    subrun_ids: children, event_counts: Object.fromEntries(children.map(id => [id, 39])),
  } : undefined;
  const message = createTestToolMessage({
    id: `failed-${toolName}`, content: reason,
    metadata: {
      tool_name: toolName, status: 'error', error: reason,
      ...(errorCode ? { error_code: errorCode } : {}),
      ...(subrunSummary ? { subrun_summary: {
        subrun_ids: [...subrunSummary.subrun_ids], event_counts: { ...subrunSummary.event_counts },
      } } : {}),
    },
  });
  return {
    ...message,
    toolPresentation: createToolPresentationProjectionPort().project({
      sourceToolName: toolName, toolCallId: message.metadata.tool_call_id,
      args: {}, result: { error: reason }, status: 'error', phase: 'error', subrunSummary,
    }),
  };
}
async function mount(message: ToolCallMessage): Promise<HTMLDivElement> {
  const host = document.createElement('div');
  document.body.append(host);
  app = createApp(ToolCallsMessage, { message });
  app.use(pinia);
  app.provide(CONVERSATION_RENDER_SCOPE_KEY, { conversationId: 'research-history' });
  app.mount(host);
  await settle();
  return host;
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  clearRendererPluginRegistryForTest();
  genericCardMounted = false;
  registerRendererPlugin({
    meta: { id: 'research-error-shell', name: 'Research errors', version: '1', description: 'Error shell fixture', developer: 'Linnya', builtin: true, required: true },
    toolCards: {
      research_run: commonToolConfigs.research_run,
      submit_research_document: commonToolConfigs.submit_research_document,
      complete_research: commonToolConfigs.complete_research,
      ordinary_tool: {
        component: defineComponent({ setup() { genericCardMounted = true; return () => h('div', 'Generic custom card'); } }),
        presentation: () => ({ data: {} }),
      },
    },
  });
  useEnabledPluginsStore().seedFromRegisteredRendererPlugins();
  registerWorkspaceNavigationPort({
    openWorkspace: async () => {}, openEmptyProjectFiles: async () => {}, openKnowledgeBase: async () => {},
    openPluginStore: async () => {}, openProjectSetup: async () => {}, openDocumentTarget: async () => {},
    openConversation: async () => {}, openDocument: async () => {}, closeWorkspaceDocument: async () => {},
    toggleWorkspacePanePlacement: () => {}, toggleWorkspaceRightPaneVisibility: () => {},
  });
});
afterEach(() => {
  app?.unmount(); app = undefined;
  document.body.innerHTML = '';
  clearRendererPluginRegistryForTest();
  vi.clearAllMocks();
});

describe('research tool errors through the real message shell', () => {
  it('keeps all six admitted child processes expandable alongside the parent error', async () => {
    const message = failedMessage('research_run');
    const host = await mount(message);
    expect(host.querySelector<HTMLElement>('.tool-card__content')?.style.display).toBe('none');
    host.querySelector<HTMLElement>('.tool-card__header')?.click();
    await vi.waitFor(() => expect(host.querySelectorAll('.subrun-trace-panel')).toHaveLength(6));
    expect(host.querySelector<HTMLElement>('.tool-card__content')?.style.display).not.toBe('none');
    expect(host.querySelector('.tool-error-card')?.textContent).toContain(reason);
    expect(host.querySelectorAll('a')).toHaveLength(0);
    expect(loadCompleteSubrunTrace).not.toHaveBeenCalled();
    host.querySelectorAll<HTMLElement>('.deep-trace__header')[5]?.click();
    await settle();
    expect(loadCompleteSubrunTrace).toHaveBeenCalledWith('research-history', message.metadata.tool_call_id,
      expect.objectContaining({ subrunId: children[5] }));
  });

  it('labels only the failed submission and never shows a saved artifact', async () => {
    const host = await mount(failedMessage('submit_research_document'));
    expect(host.querySelector('.tool-card__name')?.textContent).toContain('本次文稿提交失败');
    host.querySelector<HTMLElement>('.tool-card__header')?.click();
    await settle();
    expect(host.querySelector('.tool-error-card')?.textContent).toContain(reason);
    expect(host.textContent).not.toContain('阶段文稿已保存');
    expect(host.querySelectorAll('a, .subrun-trace-panel')).toHaveLength(0);
  });

  it('shows a failed delivery check without success navigation or an aggregate process trace', async () => {
    const host = await mount(failedMessage('complete_research'));
    expect(host.querySelector('.tool-card__name')?.textContent).toContain('本次研究交付未完成');
    host.querySelector<HTMLElement>('.tool-card__header')?.click();
    await settle();
    expect(host.querySelector('.tool-error-card')?.textContent).toContain(reason);
    expect(host.textContent).not.toContain('研究文章已交付');
    expect(host.querySelectorAll('a, .subrun-trace-panel')).toHaveLength(0);
  });

  it('leaves ordinary tool errors collapsed without mounting their registered card', async () => {
    const host = await mount(failedMessage('ordinary_tool'));
    expect(host.querySelector('.tool-card__name')?.textContent).toContain('ordinary_tool');
    expect(host.querySelector<HTMLElement>('.tool-card__content')?.style.display).toBe('none');
    host.querySelector<HTMLElement>('.tool-card__header')?.click();
    await settle();
    expect(host.querySelector('.tool-error-card')?.textContent).toContain(reason);
    expect(genericCardMounted).toBe(false);
  });

  it('keeps the ordinary actionable error directly visible and delegates its existing repair action', async () => {
    const openSettings = vi.spyOn(useUIStore(), 'openSettingsModal');
    const host = await mount(failedMessage('ordinary_tool', IMAGE_GENERATION_TOOL_ERROR_CODES.modelNotConfigured));
    expect(host.querySelector('.tool-card__header')).toBeNull();
    expect(host.querySelector('.tool-error-card--actionable')).not.toBeNull();
    host.querySelector<HTMLButtonElement>('.action-btn.primary')?.click();
    expect(openSettings).toHaveBeenCalledWith('model');
    expect(genericCardMounted).toBe(false);
  });
});
