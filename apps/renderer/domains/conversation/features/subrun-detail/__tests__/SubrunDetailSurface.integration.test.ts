// @vitest-environment jsdom

import { createPinia, setActivePinia } from 'pinia';
import { createApp, defineComponent, h, nextTick, provide, type App } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SSESubRunTraceEvent, SSEToolCallDecisionEvent } from 'linnkit/contracts';
import { ToolCallIdSchema } from 'linnkit/contracts';

import {
  clearRendererPluginRegistryForTest,
  registerRendererPlugin,
} from '@/app/plugins/registry';
import { useEnabledPluginsStore } from '@/app/plugins/enabledPluginsStore';
import { createToolPresentationProjectionPort } from '@/app/plugins/orchestration/createToolPresentationProjectionPort';
import { registerWorkspaceNavigationPort } from '@/shared/ports/workspaceNavigationPort';
import { useConversationState } from '../../../store/conversationState';
import { commonToolConfigs } from '../../../ui/tools/configs/common';
import { workspaceReadToolConfigs } from '../../../ui/tools/configs/workspace';
import { createInitialProjectionState, reduceEvent } from '../../../services/messageProjection';
import type { Conversation } from '../../../types';
import { registerToolPresentationProjectionPort } from '../../../ports/toolPresentationProjectionPort';
import { PROJECTION_TEST_SCOPE } from '../../../services/messageProjection/__tests__/helpers/projectionTestScope';
import {
  SUBRUN_DETAIL_NAVIGATION_PORT_KEY,
  SubrunDetailSurface,
  type SubrunDetailScope,
} from '..';

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

const CONVERSATION_ID = 'conversation-subrun-detail';
const PARENT_CALL_ID = 'parent-subagent-call';
const CHILD_CALL_ID = 'child-read-call';
const SUBRUN_ID = 'subrun-detail-1';

function conversation(): Conversation {
  return {
    id: CONVERSATION_ID,
    title: 'Subrun detail',
    titleOrigin: 'explicit',
    createdAt: 1,
    updatedAt: 1,
    messages: [],
    selectedAgentId: null,
  };
}

function parentDecision(): SSEToolCallDecisionEvent {
  const args = { description: '读取报告', prompt: '读取报告并总结' };
  return {
    ...PROJECTION_TEST_SCOPE,
    type: 'tool_call_decision',
    id: 'parent-decision',
    conversation_id: CONVERSATION_ID,
    turn_id: 'parent-turn',
    timestamp: 1,
    tool_name: 'subagent',
    tool_call_id: ToolCallIdSchema.parse(PARENT_CALL_ID),
    phase: 'start',
    status: 'loading',
    args,
    payload: { args },
  };
}

function childTrace(
  kind: SSESubRunTraceEvent['kind'],
  fields: Partial<SSESubRunTraceEvent>,
): SSESubRunTraceEvent {
  return {
    ...PROJECTION_TEST_SCOPE,
    type: 'subrun_trace',
    id: `trace-${kind}`,
    conversation_id: CONVERSATION_ID,
    turn_id: 'child-turn',
    timestamp: 2,
    parent_tool_call_id: ToolCallIdSchema.parse(PARENT_CALL_ID),
    subrun_id: SUBRUN_ID,
    source_event_id: `source-${kind}`,
    kind,
    ...fields,
  };
}

describe('SubrunDetailSurface integration', () => {
  let app: App<Element> | null = null;
  let unregisterProjection: (() => void) | undefined;

  beforeEach(() => {
    setActivePinia(createPinia());
    clearRendererPluginRegistryForTest();
    registerRendererPlugin({
      meta: {
        id: 'subrun-detail-integration-platform',
        name: 'Subrun detail integration platform',
        version: '1.0.0',
        description: 'Subrun detail integration fixture',
        developer: 'Linnya',
        builtin: true,
        required: true,
      },
      toolCards: { ...commonToolConfigs, ...workspaceReadToolConfigs },
    });
    useEnabledPluginsStore().seedFromRegisteredRendererPlugins();
    unregisterProjection = registerToolPresentationProjectionPort(
      createToolPresentationProjectionPort(),
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
    clearRendererPluginRegistryForTest();
    document.body.innerHTML = '';
  });

  it('从父消息 canonical trace 投影 child 工具卡，不读取父工具 result 补正文', async () => {
    const projection = createInitialProjectionState(conversation());
    expect(reduceEvent(projection, parentDecision()).success).toBe(true);
    const args = { locator: 'workspace:/report.md' };
    expect(reduceEvent(projection, childTrace('tool_call_decision', {
      tool_calls: [{
        tool_call_id: ToolCallIdSchema.parse(CHILD_CALL_ID),
        tool_name: 'read_file',
        args,
      }],
    })).success).toBe(true);
    expect(reduceEvent(projection, childTrace('tool_process', {
      source_event_id: 'source-tool-process',
      tool_call_id: ToolCallIdSchema.parse(CHILD_CALL_ID),
      tool_name: 'read_file',
      phase: 'start',
      status: 'loading',
      args,
    })).success).toBe(true);
    expect(reduceEvent(projection, childTrace('history_summary', {
      source_event_id: 'source-history-summary',
      original_message_count: 4,
      replaced_message_ids: ['source-tool-process'],
      compression_ratio: 0.25,
      included_old_summary: false,
    })).success).toBe(true);
    expect(reduceEvent(projection, childTrace('final_answer_chunk', {
      source_event_id: 'source-final-answer-chunk',
      answer_id: 'child-answer',
      seq: 0,
      delta: '报告读取完成。',
      is_last: true,
    })).success).toBe(true);
    expect(reduceEvent(projection, childTrace('final_answer', {
      source_event_id: 'source-final-answer',
      answer_id: 'child-answer',
      content: '报告读取完成。',
      completion_reason: 'terminal',
    })).success).toBe(true);

    const parentMessage = projection.conversation.messages[0];
    if (parentMessage?.type !== 'tool_calls') throw new Error('Expected parent tool message');
    const state = useConversationState();
    state.createConversation({ id: CONVERSATION_ID, title: 'Subrun detail', autoActivate: true });
    state.getActiveConversation()?.messages.push(parentMessage);
    const scope: SubrunDetailScope = {
      conversationId: CONVERSATION_ID,
      parentMessageId: parentMessage.id,
      parentToolCallId: PARENT_CALL_ID,
      subrunId: SUBRUN_ID,
      description: '读取报告',
    };
    const mountPoint = document.createElement('div');
    document.body.appendChild(mountPoint);
    app = createApp(defineComponent({
      setup() {
        provide(SUBRUN_DETAIL_NAVIGATION_PORT_KEY, {
          open: () => undefined,
          close: () => undefined,
        });
        return () => h(SubrunDetailSurface, { scope, messages: state.getActiveConversation()?.messages ?? [] });
      },
    }));
    app.mount(mountPoint);
    await Promise.resolve();
    await nextTick();
    await Promise.resolve();
    await nextTick();

    // child trace admission 在 Vue flush 之外原子提交；等待业务可见结果，禁止用固定 tick 数猜调度时序。
    await vi.waitFor(() => {
      expect(mountPoint.querySelector(
        `[data-conversation-message-id="subrun-tool:${SUBRUN_ID}:${CHILD_CALL_ID}"]`,
      )).not.toBeNull();
    });
    const invocationMessage = mountPoint.querySelector(
      `[data-conversation-message-id="subrun-user:${SUBRUN_ID}"]`,
    );
    expect(invocationMessage).not.toBeNull();
    expect(invocationMessage?.textContent).toContain('读取报告并总结');
    expect(invocationMessage?.querySelector(
      '[title="conversation.userMessage.action.edit"]',
    )).toBeNull();
    expect(invocationMessage?.querySelector(
      '[title="conversation.userMessage.action.regenerate"]',
    )).toBeNull();
    expect(invocationMessage?.querySelector(
      '[title="conversation.userMessage.action.copy"]',
    )).not.toBeNull();
    expect(mountPoint.querySelector('.tool-registry-card')).not.toBeNull();
    expect(mountPoint.textContent).toContain('阅读 {target}');
    expect(mountPoint.textContent).toContain('conversation.summary.text.completed');
    expect(mountPoint.querySelector('.summary-status-completed')).not.toBeNull();
    expect(mountPoint.textContent).toContain('报告读取完成。');
    expect(mountPoint.querySelector('.ui-card-body--bounded')).toBeNull();
    const rows = Array.from(mountPoint.querySelectorAll<HTMLElement>('.conversation-visual-row'));
    expect(rows).toHaveLength(4);
    expect(rows[0]?.classList.contains('is-turn-start')).toBe(true);
    expect(rows[0]?.classList.contains('is-turn-end')).toBe(false);
    expect(rows[1]?.classList.contains('is-turn-start')).toBe(false);
    expect(rows[1]?.classList.contains('is-turn-end')).toBe(false);
    expect(rows[2]?.classList.contains('is-turn-start')).toBe(false);
    expect(rows[2]?.classList.contains('is-turn-end')).toBe(false);
    expect(rows[3]?.classList.contains('is-turn-start')).toBe(false);
    expect(rows[3]?.classList.contains('is-turn-end')).toBe(true);
    expect(new Set(rows.map(row => row.dataset.visualTurnId)).size).toBe(1);
    expect(mountPoint.querySelector('.virtual-conversation-item')).toBeNull();
    expect(mountPoint.querySelector('.subrun-detail__back')).toBeNull();
    expect(mountPoint.querySelector('h2')).toBeNull();
    expect(mountPoint.querySelector('.subrun-detail')?.getAttribute('aria-label')).toBe('读取报告');
  });
});
