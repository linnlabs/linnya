// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { createApp, defineComponent, h, nextTick, provide, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { conversationVisualTurnIdFromUserMessageId } from '@app/schemas';
import type { SSESubRunTraceEvent, SSEToolCallDecisionEvent } from '@linnlabs/linnkit/contracts';
import { ToolCallIdSchema } from '@linnlabs/linnkit/contracts';

import {
  clearRendererPluginRegistryForTest,
  registerRendererPlugin,
} from '@/app/plugins/registry';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { createToolPresentationProjectionPort } from '@/app/plugins/orchestration/createToolPresentationProjectionPort';
import { createToolCompactStepProjectionPort } from '@/app/plugins/orchestration/createToolCompactStepProjectionPort';
import { commonToolConfigs } from '../../../ui/tools/configs/common';
import { workspaceReadToolConfigs } from '../../../ui/tools/configs/workspace';
import { createInitialProjectionState, reduceEvent } from '../../../services/messageProjection';
import type { Conversation } from '../../../types';
import type { ConversationVisualRow } from '../../../ui/messageCanvas';
import VirtualConversationCanvas from '../../../ui/conversationView/components/VirtualConversationCanvas.vue';
import { MESSAGE_ENTRY_ANIMATION_PORT_KEY } from '../../../definitions/messageEntryAnimation';
import { CONVERSATION_RENDER_SCOPE_KEY } from '../../../definitions/conversationRenderScope';
import { SUBRUN_DETAIL_NAVIGATION_PORT_KEY, type SubrunDetailScope } from '../../subrun-detail';
import { registerToolPresentationProjectionPort } from '../../../ports/toolPresentationProjectionPort';
import { registerToolCompactStepProjectionPort } from '../../../ports/toolCompactStepProjectionPort';
import { PROJECTION_TEST_SCOPE } from '../../../services/messageProjection/__tests__/helpers/projectionTestScope';
import { registerWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';

vi.mock('@app/localization', () => ({
  useLocalization: () => ({
    currentLocale: { value: 'zh-CN' },
    message: (key: string) => key,
    t: (descriptor: string | { fallback?: string; key?: string }) => (
      typeof descriptor === 'string' ? descriptor : descriptor.fallback ?? descriptor.key ?? ''
    ),
  }),
}));

vi.mock('@/shared/ipc/workspaceGateway', () => ({ workspaceGateway: {} }));
vi.mock('../../../ui/message/components/stream/ConversationMarkdownRenderer', () => ({
  default: { props: ['content'], template: '<div>{{ content }}</div>' },
}));
vi.mock('../../../ui/message/components/MarkstreamRenderer.vue', () => ({
  default: { props: ['content'], template: '<div>{{ content }}</div>' },
}));

vi.mock('../../subrun-trace/orchestration/loadSubrunTrace', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('../../subrun-trace/orchestration/loadSubrunTrace')>();
  return {
    ...original,
    loadCompleteSubrunTrace: vi.fn(async () => ({
      status: 'ready' as const,
      buckets: {},
      eventCount: 0,
      nextCursor: null,
      revision: 1,
    })),
  };
});

const CONVERSATION_ID = 'conversation-subrun-progress-row';
const PARENT_TOOL_CALL_ID = 'call-subagent-progress-row';

function createConversation(): Conversation {
  return {
    id: CONVERSATION_ID,
    title: 'Subrun progress row',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

function createDecision(): SSEToolCallDecisionEvent {
  const args = { description: '执行检查', prompt: '逐项检查并报告' };
  return {
    ...PROJECTION_TEST_SCOPE,
    type: 'tool_call_decision',
    id: 'decision-subagent-progress-row',
    conversation_id: CONVERSATION_ID,
    turn_id: 'turn-subagent-progress-row',
    timestamp: 1,
    tool_name: 'subagent',
    tool_call_id: ToolCallIdSchema.parse(PARENT_TOOL_CALL_ID),
    phase: 'start',
    status: 'loading',
    args,
    payload: { args },
  };
}

function createChildTrace(): SSESubRunTraceEvent {
  return {
    ...PROJECTION_TEST_SCOPE,
    type: 'subrun_trace',
    id: 'trace-child-process',
    conversation_id: CONVERSATION_ID,
    turn_id: 'turn-subagent-child',
    timestamp: 2,
    parent_tool_call_id: ToolCallIdSchema.parse(PARENT_TOOL_CALL_ID),
    subrun_id: 'subrun-progress-row',
    source_event_id: 'child-process',
    kind: 'tool_process',
    tool_name: 'read_file',
    tool_call_id: ToolCallIdSchema.parse('child-read'),
    phase: 'start',
    status: 'loading',
    args: { locator: 'workspace:/report.md' },
  };
}

async function flushAsyncComponent(): Promise<void> {
  for (let index = 0; index < 6; index += 1) {
    await Promise.resolve();
    await nextTick();
  }
}

describe('Subrun progress virtual row integration', () => {
  let app: App<Element> | null = null;
  let unregisterProjection: (() => void) | undefined;
  let unregisterCompactProjection: (() => void) | undefined;

  beforeEach(() => {
    setActivePinia(createPinia());
    clearRendererPluginRegistryForTest();
    registerRendererPlugin({
      meta: {
        id: 'subrun-progress-integration-platform',
        name: 'Subrun progress integration platform',
        version: '1.0.0',
        description: 'Subrun progress integration fixture',
        developer: 'Linnya',
        builtin: true,
        required: true,
      },
      toolCards: {
        subagent: commonToolConfigs.subagent,
        read_file: workspaceReadToolConfigs.read_file,
        workspace_read_file: workspaceReadToolConfigs.workspace_read_file,
      },
    });
    useEnabledPluginsStore().seedFromRegisteredRendererPlugins();
    unregisterProjection = registerToolPresentationProjectionPort(
      createToolPresentationProjectionPort(),
    );
    unregisterCompactProjection = registerToolCompactStepProjectionPort(
      createToolCompactStepProjectionPort(),
    );
    registerWorkspaceNavigationPort({
      openWorkspace: async () => undefined,
      openEmptyProjectFiles: async () => undefined,
      openKnowledgeBase: async () => undefined,
      openPluginStore: async () => undefined,
      openProjectSetup: async () => undefined,
      openDocumentTarget: async () => undefined,
      openConversation: async () => undefined,
      openDocument: async () => undefined,
      toggleWorkspacePanePlacement: () => undefined,
      toggleWorkspaceRightPaneVisibility: () => undefined,
      closeWorkspaceDocument: async () => undefined,
    });
  });

  afterEach(() => {
    app?.unmount();
    app = null;
    unregisterProjection?.();
    unregisterProjection = undefined;
    unregisterCompactProjection?.();
    unregisterCompactProjection = undefined;
    clearRendererPluginRegistryForTest();
    document.body.innerHTML = '';
  });

  it('父卡默认折叠，运行标题跟随 child 紧凑步骤，并按正式 scope 打开 Host 详情', async () => {
    const projection = createInitialProjectionState(createConversation());
    expect(reduceEvent(projection, createDecision()).success).toBe(true);
    expect(reduceEvent(projection, createChildTrace()).success).toBe(true);
    const toolMessage = projection.conversation.messages[0];
    if (toolMessage?.type !== 'tool_calls') throw new Error('Expected subagent tool message');

    const visualTurnId = conversationVisualTurnIdFromUserMessageId('user-subrun-progress-row');
    const row: ConversationVisualRow = {
      key: `msg_${toolMessage.id}`,
      kind: 'message',
      estimatedHeight: 180,
      visualTurnId,
      turnContext: {
        id: visualTurnId,
        userMessageId: null,
        sourceMessageIds: [toolMessage.id],
      },
      isTurnStart: true,
      isTurnEnd: true,
      role: toolMessage.role,
      bounded: false,
      payload: toolMessage,
    };
    const openedScopes: SubrunDetailScope[] = [];
    const errors: unknown[] = [];
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp(defineComponent({
      setup() {
        provide(CONVERSATION_RENDER_SCOPE_KEY, { conversationId: CONVERSATION_ID });
        provide(MESSAGE_ENTRY_ANIMATION_PORT_KEY, {
          isPending: () => false,
          consume: () => undefined,
        });
        provide(SUBRUN_DETAIL_NAVIGATION_PORT_KEY, {
          open: scope => openedScopes.push(scope),
          close: () => undefined,
        });
        return () => h(VirtualConversationCanvas, {
          items: [row],
          messages: [toolMessage],
          virtualRows: [{
            item: row,
            index: 0,
            virtualItem: {
              key: row.key,
              index: 0,
              start: 20,
              end: 200,
              size: 180,
              lane: 0,
            },
          }],
          totalHeight: 180,
          scrollMargin: 20,
          timelinePositions: [],
          measureElement: vi.fn(),
          activeRunIds: [PROJECTION_TEST_SCOPE.run_id],
        });
      },
    }));
    app.config.errorHandler = error => errors.push(error);
    app.mount(mountPoint);
    await flushAsyncComponent();

    await vi.waitFor(() => {
      expect(
        mountPoint.querySelectorAll('.deep-trace__row'),
        `${mountPoint.innerHTML}\n${errors.map(String).join('\n')}`,
      ).toHaveLength(1);
    });
    expect(mountPoint.querySelector('.tool-registry-card.tool-card')).not.toBeNull();
    expect(mountPoint.querySelector('.tool-registry-card.is-collapsed')).not.toBeNull();
    expect(mountPoint.querySelector('.tool-group-mode')).toBeNull();
    expect(mountPoint.querySelector('.tool-card__header')).not.toBeNull();
    expect(mountPoint.querySelector('.tool-card__name-text')?.textContent).toContain('读取项目文件');
    expect(mountPoint.querySelector('.tool-card__name-text--active')).not.toBeNull();
    expect(mountPoint.querySelector('.loading-spinner')).toBeNull();
    expect(mountPoint.querySelector('.subrun-progress-card')).not.toBeNull();
    expect(mountPoint.querySelector('.subrun-progress')).toBeNull();
    expect(mountPoint.querySelector('.ui-card-body--bounded')).toBeNull();
    expect(mountPoint.querySelector('.thought-container')).toBeNull();
    expect(mountPoint.querySelector<HTMLElement>('.tool-card__content')?.style.display).toBe('none');
    expect(mountPoint.querySelector('.deep-trace__toggle')).toBeNull();
    expect(mountPoint.querySelector('.deep-trace__action')).not.toBeNull();
    expect(mountPoint.querySelectorAll('.deep-trace__row')).toHaveLength(1);
    expect(mountPoint.textContent).toContain(
      '读取项目文件',
    );

    mountPoint.querySelector<HTMLElement>('.tool-card__header')?.click();
    await nextTick();
    expect(mountPoint.querySelector<HTMLElement>('.tool-card__content')?.style.display).toBe('');

    mountPoint.querySelector<HTMLButtonElement>('.deep-trace__action')?.click();
    expect(openedScopes).toEqual([{
      conversationId: CONVERSATION_ID,
      parentMessageId: toolMessage.id,
      parentToolCallId: PARENT_TOOL_CALL_ID,
      subrunId: 'subrun-progress-row',
      description: '执行检查',
    }]);
    expect(errors).toEqual([]);
  });
});
