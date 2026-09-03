// @vitest-environment jsdom

import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandProcessHandleSchema, PtyTerminalScreenProjectionSchema } from '@app/schemas/commands';
import type { ToolCardPresentation } from '@linnya/plugin-host-contract/renderer/toolUi';

import type { CommandExecutionPresentationData } from '../definitions/commandExecutionPresentation';
import { useCommandCardControlStore } from '../store/commandCardControlStore';

const cancelCommand = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const submitProtectedInput = vi.hoisted(() => vi.fn().mockResolvedValue({ status: 'accepted' }));
const writeClipboardText = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../orchestration/useCommandCardControl', () => ({
  cancelCommandFromCurrentCard: cancelCommand,
  submitProtectedInputFromCurrentCard: submitProtectedInput,
}));

vi.mock('../../../ui/useConversationLocalization', () => ({
  useConversationLocalization: () => ({
    currentLocale: ref('zh-CN'),
    conversationMessage: (key: string, params?: Readonly<Record<string, string | number>>) => {
      if (key === 'conversation.tool.command.omittedLines') {
        return `已省略前面的 ${params?.['count'] ?? 0} 行`;
      }
      if (key === 'conversation.tool.command.state.running') return '运行中';
      if (key === 'conversation.tool.command.state.completed') return '已结束';
      if (key === 'conversation.tool.command.terminal') return '终端输出';
      if (key === 'conversation.tool.command.outputIncomplete') return '完整输出不完整';
      if (key === 'conversation.tool.command.auditIncomplete') return '审计记录不完整';
      if (key === 'conversation.tool.command.outputIncomplete.retainedWindowOmitted') {
        return '较早输出已省略';
      }
      return key;
    },
  }),
}));

import CommandExecutionCard from './CommandExecutionCard.vue';

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: writeClipboardText },
});

afterEach(() => {
  document.body.innerHTML = '';
  cancelCommand.mockClear();
  submitProtectedInput.mockReset();
  submitProtectedInput.mockResolvedValue({ status: 'accepted' });
  writeClipboardText.mockClear();
});

describe('CommandExecutionCard', () => {
  it('按 host 的稀疏屏幕渲染 PTY 行、光标和省略事实', async () => {
    const screen = PtyTerminalScreenProjectionSchema.parse({
      mode: 'pty',
      scope: 'terminal_window',
      revision: 7,
      columns: 12,
      rows: 2,
      active_buffer: 'normal',
      total_buffer_lines: 5,
      window_start_line: 3,
      viewport_start_line: 3,
      scrollback_lines: 3,
      omitted_before_lines: 3,
      cursor: { column: 2, row: 0 },
      lines: [{
        wrapped: false,
        text: '你A',
        cell_metrics: [{ column: 0, text_offset: 0, text_length: 1, display_width: 2 }],
        style_runs: [],
      }],
    });
    const data: CommandExecutionPresentationData = {
      kind: 'command_execution',
      source: 'shell',
      state: 'running',
      command: 'printf "你A"',
      interactive: true,
      observation: '你A',
      display: {
        mode: 'pty',
        coverage: 'omitted',
        outputPhase: 'open',
        textProjection: 'available',
        screen,
      },
      incomplete: true,
      incompleteReasons: ['retained_window_omitted'],
      executionFacts: {
        protocol_version: 1,
        kind: 'command_execution_presentation_facts',
        timing: { status: 'started', started_at_ms: 1_700_000_000_000 },
        permission: {
          base_level: 'read_only',
          effective_level: 'standard',
          source: 'allow_once',
          internal_data_access: 'denied',
        },
      },
    };
    const presentation: ToolCardPresentation<CommandExecutionPresentationData> = {
      uiKey: 'shell',
      status: 'success',
      phase: 'complete',
      data,
      title: { text: { key: 'conversation.tool.command.running', fallback: 'Running command' } },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(CommandExecutionCard, { presentation });
    app.use(createPinia());

    app.mount(container);
    await nextTick();

    expect(container.querySelector('.command-execution-card__command')?.textContent).toBe('printf "你A"');
    expect(container.querySelector('.command-terminal__omitted')?.textContent?.trim()).toBe('已省略前面的 3 行');
    expect(container.querySelector('.command-terminal__line')?.textContent).toContain('你A');
    expect(container.querySelector('.command-terminal__cursor')?.textContent).toBe('A');
    expect(container.querySelector('.command-terminal')?.getAttribute('aria-label')).toBe('终端输出');
    expect(container.querySelector('.command-execution-card__details')).toBeNull();
    expect(container.querySelector('.command-execution-card__warning')?.textContent).toContain(
      '完整输出不完整：较早输出已省略',
    );

    app.unmount();
  });

  it('只有当前页面持有不透明 ticket 时显示取消按钮并提交 handle', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const handle = CommandProcessHandleSchema.parse(
      'command_process_00000000-0000-4000-8000-000000000003',
    );
    useCommandCardControlStore().replaceSnapshot({
      protocol_version: 1,
      kind: 'command_card_control_page_snapshot',
      page_ticket: 'command_control_page_00000000-0000-4000-8000-000000000004',
      conversation_id: 'conversation-card-control',
      capabilities: [{
        protocol_version: 1,
        kind: 'command_card_control_capability',
        process_handle: handle,
        control_ticket: 'command_control_ticket_00000000-0000-4000-8000-000000000005',
      }],
      settlements: [],
      settlement_failures: [],
      audit_failures: [],
    });
    const presentation: ToolCardPresentation<CommandExecutionPresentationData> = {
      uiKey: 'shell',
      status: 'success',
      phase: 'complete',
      title: { text: { key: 'conversation.tool.command.running', fallback: 'Running command' } },
      data: {
        kind: 'command_execution',
        source: 'shell',
        state: 'running',
        command: 'sleep 60',
        interactive: false,
        processHandle: handle,
        observation: '',
        incomplete: false,
        incompleteReasons: [],
      },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(CommandExecutionCard, {
      presentation,
      conversationId: 'conversation-card-control',
    });
    app.use(pinia);
    app.mount(container);
    await nextTick();
    const button = container.querySelector<HTMLButtonElement>('.command-execution-card__cancel');
    expect(button).not.toBeNull();
    button?.click();
    await nextTick();
    expect(cancelCommand).toHaveBeenCalledWith(handle);
    app.unmount();
  });

  it('保护输入只在 PTY capability 下出现，发送后立即清空局部密码且不进入 store', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const handle = CommandProcessHandleSchema.parse(
      'command_process_00000000-0000-4000-8000-000000000033',
    );
    useCommandCardControlStore().replaceSnapshot({
      protocol_version: 1,
      kind: 'command_card_control_page_snapshot',
      page_ticket: 'command_control_page_00000000-0000-4000-8000-000000000034',
      conversation_id: 'conversation-protected-input',
      capabilities: [{
        protocol_version: 1,
        kind: 'command_card_control_capability',
        process_handle: handle,
        control_ticket: 'command_control_ticket_00000000-0000-4000-8000-000000000035',
        protected_input_ticket: 'command_protected_input_ticket_00000000-0000-4000-8000-000000000036',
      }],
      settlements: [],
      settlement_failures: [],
      audit_failures: [],
    });
    let settleSubmission = (_value: { readonly status: 'accepted' }): void => {};
    submitProtectedInput.mockImplementationOnce(() => new Promise((resolve) => {
      settleSubmission = resolve;
    }));
    const presentation: ToolCardPresentation<CommandExecutionPresentationData> = {
      uiKey: 'shell',
      status: 'success',
      phase: 'complete',
      title: { text: { key: 'conversation.tool.command.running', fallback: 'Running command' } },
      data: {
        kind: 'command_execution',
        source: 'shell',
        state: 'running',
        command: 'ssh protected.example',
        interactive: true,
        processHandle: handle,
        observation: '',
        incomplete: false,
        incompleteReasons: [],
      },
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const app = createApp(CommandExecutionCard, {
      presentation,
      conversationId: 'conversation-protected-input',
    });
    app.use(pinia);
    app.mount(container);
    await nextTick();

    const openButton = container.querySelector<HTMLButtonElement>(
      '.command-execution-card__protected-input',
    );
    expect(openButton).not.toBeNull();
    openButton?.click();
    await nextTick();
    const field = document.body.querySelector<HTMLInputElement>('.secret-input__control');
    expect(field?.type).toBe('password');
    if (!field) throw new Error('protected input field unavailable');
    field.value = 'private-value';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    document.body.querySelector<HTMLButtonElement>('.command-protected-input__button.is-primary')?.click();
    await nextTick();

    expect(submitProtectedInput).toHaveBeenCalledWith(handle, 'private-value');
    expect(field.value).toBe('');
    expect(JSON.stringify(useCommandCardControlStore().$state)).not.toContain('private-value');
    settleSubmission({ status: 'accepted' });
    await vi.waitFor(() => {
      expect(document.body.querySelector('.secret-input__control')).toBeNull();
    });
    app.unmount();
  });

  it('展示 facts 或 owner snapshot 的审计不完整事实，不把它写成输出不完整', async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const handle = CommandProcessHandleSchema.parse(
      'command_process_00000000-0000-4000-8000-000000000013',
    );
    useCommandCardControlStore().replaceSnapshot({
      protocol_version: 1,
      kind: 'command_card_control_page_snapshot',
      page_ticket: 'command_control_page_00000000-0000-4000-8000-000000000014',
      conversation_id: 'conversation-audit-warning',
      capabilities: [],
      settlements: [],
      settlement_failures: [],
      audit_failures: [handle],
    });
    const title = { text: { key: 'conversation.tool.command.completed', fallback: 'Command completed' } } as const;
    const fromDurableFacts: ToolCardPresentation<CommandExecutionPresentationData> = {
      uiKey: 'shell',
      status: 'success',
      phase: 'complete',
      title,
      data: {
        kind: 'command_execution',
        source: 'shell',
        state: 'completed',
        command: 'printf durable',
        interactive: false,
        observation: 'durable',
        terminal: { outcome: 'exited', exitCode: 0, signal: null },
        executionFacts: {
          protocol_version: 1,
          kind: 'command_execution_presentation_facts',
          timing: { status: 'started', started_at_ms: 10, settled_at_ms: 20 },
          audit_status: 'incomplete',
        },
        incomplete: false,
        incompleteReasons: [],
      },
    };
    const fromOwnerSnapshot: ToolCardPresentation<CommandExecutionPresentationData> = {
      uiKey: 'shell',
      status: 'success',
      phase: 'complete',
      title,
      data: {
        kind: 'command_execution',
        source: 'shell',
        state: 'completed',
        command: 'printf owner',
        interactive: false,
        processHandle: handle,
        observation: 'owner',
        incomplete: false,
        incompleteReasons: [],
      },
    };
    const Root = defineComponent(() => () => h('div', [
      h(CommandExecutionCard, {
        presentation: fromDurableFacts,
        conversationId: 'conversation-audit-warning',
      }),
      h(CommandExecutionCard, {
        presentation: fromOwnerSnapshot,
        conversationId: 'conversation-audit-warning',
      }),
    ]));
    const container = document.createElement('div');
    const app = createApp(Root);
    app.use(pinia);
    app.mount(container);
    await nextTick();

    expect(container.textContent?.match(/审计记录不完整/g)).toHaveLength(2);
    expect(container.textContent).not.toContain('完整输出不完整');
    expect(container.querySelector('.command-execution-card__status')?.textContent?.trim()).toBe('已结束');
    expect(container.querySelector('.command-execution-card__duration')).not.toBeNull();
    expect(container.querySelector('.command-execution-card__terminal')).toBeNull();
    container.querySelector<HTMLButtonElement>('.command-execution-card__copy')?.click();
    await vi.waitFor(() => {
      expect(writeClipboardText).toHaveBeenCalledWith('$ printf durable\ndurable');
    });
    app.unmount();
  });

});
