// @vitest-environment jsdom

import { computed, createApp, defineComponent, h, nextTick, ref, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CommandApprovalPageSnapshotV1Schema,
  CommandCardControlPageSnapshotV1Schema,
} from '@app/schemas/commands';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';
import { useCommandApprovalProjectionStore } from '../../command-approval';
import { useCommandCardControlStore } from '../store/commandCardControlStore';
import {
  provideToolExecutionActivity,
  executionActivity,
} from '../../../shared/execution-presentation';
import { projectCommandExecutionPresentation } from '../functions/projectCommandExecutionPresentation';
import type { CommandExecutionPresentationData } from '../definitions/commandExecutionPresentation';
import CommandExecutionTitle from './CommandExecutionTitle.vue';
import CommandExecutionCard from './CommandExecutionCard.vue';

vi.mock('@app/localization', () => ({
  useLocalization: () => ({
    t: (descriptor: { readonly fallback: string }) => descriptor.fallback,
  }),
}));
vi.mock('../../../ui/useConversationLocalization', () => ({
  useConversationLocalization: () => ({
    currentLocale: ref('en-US'),
    conversationMessage: (key: string) => key,
  }),
}));

const TOOL_IDENTITY = { runId: 'run-approval', toolCallId: 'call-approval' };
const CONVERSATION_ID = 'conversation-approval';
const HANDLE = 'command_process_00000000-0000-4000-8000-000000000001';

function approvalSnapshot(status: 'awaiting_reply' | 'processing' = 'awaiting_reply') {
  return CommandApprovalPageSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'command_approval_page_snapshot',
    page_ticket: 'page-command-approval',
    pending: [
      {
        protocol_version: 1,
        kind: 'command_approval_pending_projection',
        approval_request_id: 'command_approval_00000000-0000-4000-8000-000000000002',
        conversation_id: CONVERSATION_ID,
        agent_run_id: TOOL_IDENTITY.runId,
        origin_tool_call_id: TOOL_IDENTITY.toolCallId,
        command_execution_id: 'command_execution_00000000-0000-4000-8000-000000000003',
        command: 'rm probe.txt',
        cwd: '/tmp/command-approval',
        reasons: [{ type: 'fixed_risk_rule', rule_id: 'delete.file', category: 'delete' }],
        available_choices: ['allow_once', 'deny'],
        requested_at_ms: 100,
        status,
      },
    ],
  });
}

function terminalSnapshot() {
  return CommandCardControlPageSnapshotV1Schema.parse({
    protocol_version: 1,
    kind: 'command_card_control_page_snapshot',
    page_ticket: 'command_control_page_00000000-0000-4000-8000-000000000004',
    conversation_id: CONVERSATION_ID,
    capabilities: [],
    settlements: [
      {
        protocol_version: 1,
        kind: 'command_card_execution_settlement',
        conversation_id: CONVERSATION_ID,
        agent_run_id: TOOL_IDENTITY.runId,
        process_handle: HANDLE,
        origin_tool_call_id: TOOL_IDENTITY.toolCallId,
        started_at_ms: 200,
        settled_at_ms: 652,
        audit_status: 'complete',
        terminal: { outcome: 'exited', exitCode: 0, signal: null },
      },
    ],
    settlement_failures: [],
    audit_failures: [],
  });
}

function loadingPresentation(): ToolCardPresentation<CommandExecutionPresentationData> {
  return {
    uiKey: 'shell',
    status: 'loading',
    phase: 'start',
    ...projectCommandExecutionPresentation({
      sourceToolName: 'shell',
      uiKey: 'shell',
      toolCallId: TOOL_IDENTITY.toolCallId,
      args: { command: 'rm probe.txt' },
      result: undefined,
      status: 'loading',
      phase: 'start',
    }),
  };
}

let app: App<Element> | undefined;
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
});

function mountCommand(presentation = ref(loadingPresentation()), runId = TOOL_IDENTITY.runId) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  app = createApp(
    defineComponent(() => {
      provideToolExecutionActivity(
        () => presentation.value.status,
        computed(() => executionActivity('running')),
        () => true
      );
      return () =>
        h('div', [
          h(CommandExecutionTitle, {
            presentation: presentation.value,
            conversationId: CONVERSATION_ID,
            toolIdentity: { ...TOOL_IDENTITY, runId },
          }),
          h(CommandExecutionCard, {
            presentation: presentation.value,
            conversationId: CONVERSATION_ID,
            toolIdentity: { ...TOOL_IDENTITY, runId },
          }),
        ]);
    })
  );
  app.use(setActivePinia(createPinia()));
  app.mount(container);
  return container;
}

describe('command approval and terminal presentation', () => {
  it('审批等待、处理中、通过后的准备与真实终态由同一规则驱动标题和正文', async () => {
    const presentation = ref(loadingPresentation());
    const container = mountCommand(presentation);
    const approvals = useCommandApprovalProjectionStore();
    const controls = useCommandCardControlStore();
    approvals.pageOpened(approvalSnapshot());
    await nextTick();
    expect(container.textContent).toContain('Awaiting approval: rm probe.txt');
    expect(container.textContent).toContain('conversation.tool.command.awaitingApproval');
    expect(container.querySelector('.execution-progress-text--shimmer')).toBeNull();
    expect(container.querySelector('.tool-activity')).toBeNull();

    approvals.projectionChanged(approvalSnapshot('processing'));
    await nextTick();
    expect(container.textContent).toContain('Processing approval: rm probe.txt');
    expect(container.textContent).toContain('conversation.tool.command.approvalProcessing');

    approvals.projectionChanged({ ...approvalSnapshot(), pending: [] });
    await nextTick();
    expect(container.textContent).toContain('Preparing command: rm probe.txt');
    expect(container.textContent).not.toContain('conversation.tool.command.state.completed');

    controls.replaceSnapshot(terminalSnapshot());
    await nextTick();
    expect(container.textContent).toContain('Command completed: rm probe.txt');
    expect(container.textContent).toContain('conversation.tool.command.state.completed');
    expect(container.querySelector('.tool-activity')).toBeNull();
    expect(container.querySelector('.execution-progress-text--shimmer')).toBeNull();
    expect(container.querySelector('.command-execution-card__duration')?.textContent).toContain(
      '452'
    );
    // 展示只叠加真实 Commands 终态，不伪造 Runtime tool_output。
    expect(presentation.value.status).toBe('loading');
    expect(presentation.value.data.state).toBe('starting');

    approvals.projectionChanged(approvalSnapshot());
    await nextTick();
    expect(container.textContent).toContain('Command completed: rm probe.txt');
    expect(container.textContent).not.toContain('Awaiting approval');
  });

  it('拒绝启动与已取消均保留自己的终态，不被迟到审批或旧 loading 遮住', async () => {
    const presentation = ref(loadingPresentation());
    const container = mountCommand(presentation);
    useCommandApprovalProjectionStore().pageOpened(approvalSnapshot());
    presentation.value = {
      ...presentation.value,
      status: 'success',
      phase: 'complete',
      data: {
        kind: 'command_execution',
        source: 'shell',
        state: 'rejected',
        toolCallId: TOOL_IDENTITY.toolCallId,
        command: 'rm probe.txt',
        interactive: false,
        observation: '',
        incomplete: false,
        incompleteReasons: [],
      },
    };
    await nextTick();
    expect(container.textContent).toContain('Command rejected: rm probe.txt');
    expect(container.textContent).toContain('conversation.tool.command.state.rejected');
    expect(container.textContent).not.toContain('Awaiting approval');

    presentation.value = loadingPresentation();
    const snapshot = terminalSnapshot();
    useCommandCardControlStore().replaceSnapshot({
      ...snapshot,
      settlements: snapshot.settlements.map(value => ({
        ...value,
        terminal: { outcome: 'terminated', reason: 'cancelled', exitCode: null, signal: 'SIGTERM' },
      })),
    });
    await nextTick();
    expect(container.textContent).toContain('conversation.tool.command.terminated.cancelled');
    expect(container.querySelector('.tool-activity')).toBeNull();
    expect(container.querySelector('.execution-progress-text--shimmer')).toBeNull();
  });

  it('同一toolCallId在另一个run不能被当前审批或终态串线；reload恢复同一状态', async () => {
    const container = mountCommand(undefined, 'run-other');
    useCommandApprovalProjectionStore().pageOpened(approvalSnapshot());
    useCommandCardControlStore().replaceSnapshot(terminalSnapshot());
    await nextTick();
    expect(container.textContent).toContain('Preparing command: rm probe.txt');
    expect(container.textContent).not.toContain('Awaiting approval');
    expect(container.textContent).not.toContain('Command completed');
    app?.unmount();

    const reloaded = mountCommand();
    useCommandApprovalProjectionStore().pageOpened(approvalSnapshot());
    await nextTick();
    expect(reloaded.textContent).toContain('Awaiting approval');
    useCommandCardControlStore().replaceSnapshot(terminalSnapshot());
    await nextTick();
    expect(reloaded.textContent).toContain('Command completed');
    expect(reloaded.querySelector('.tool-activity')).toBeNull();
  });
});
