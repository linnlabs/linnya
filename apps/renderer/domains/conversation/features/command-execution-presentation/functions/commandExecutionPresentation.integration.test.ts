import { describe, expect, it } from 'vitest';
import { ConversationUiMessageSchema, JsonValueSchema, type JsonValue } from '@app/schemas';
import {
  CommandExecutionPresentationFactsV1Schema,
  PtyTerminalScreenProjectionSchema,
  type CommandToolOutputDisplay,
} from '@app/schemas/commands';
import { createSSEToolCallDecisionEvent, createSSEToolOutputEvent } from '@linnlabs/linnkit/contracts';

import {
  createTestToolMessage,
  requireTestToolMessage,
} from '../../../testing/functions/createConversationTestMessage';
import type { ToolCallMessage } from '../../../types';
import { mapUiMessageDtoToConversationMessage } from '../../../message-window/functions/mapUiMessageDto';
import {
  registerToolPresentationProjectionPort,
  type ToolPresentationProjectionPort,
} from '../../../ports/toolPresentationProjectionPort';
import { createInitialProjectionState, reduceEvent } from '../../../services/messageProjection';
import { PROJECTION_TEST_SCOPE } from '../../../services/messageProjection/__tests__/helpers/projectionTestScope';
import { aggregateCommandExecutionMessages } from './aggregateCommandExecutionMessages';
import { projectCommandExecutionPresentation } from './projectCommandExecutionPresentation';
import { projectPtyTerminalLineSegments } from './projectPtyTerminalLineSegments';

const HANDLE = 'command_process_123e4567-e89b-42d3-a456-426614174000';
const SHELL_PRESENTATION = CommandExecutionPresentationFactsV1Schema.parse({
  protocol_version: 1,
  kind: 'command_execution_presentation_facts',
  timing: { status: 'started', started_at_ms: 100 },
  permission: {
    base_level: 'read_only',
    effective_level: 'standard',
    source: 'allow_once',
    internal_data_access: 'denied',
  },
});

const PIPE_DISPLAY: CommandToolOutputDisplay = {
  mode: 'pipe',
  coverage: 'complete',
  outputPhase: 'open',
  textProjection: 'available',
};

const COMMAND_PROJECTION_PORT: ToolPresentationProjectionPort = {
  project(request) {
    if (request.sourceToolName !== 'shell' && request.sourceToolName !== 'process') {
      return undefined;
    }
    return {
      uiKey: request.sourceToolName,
      status: request.status,
      phase: request.phase,
      ...projectCommandExecutionPresentation({
        ...request,
        uiKey: request.sourceToolName,
      }),
    };
  },
};

function parseToolResult(value: unknown): { data: JsonValue; observation: string } {
  const result = JsonValueSchema.parse(value);
  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    throw new Error('command tool test result must be an object');
  }
  const observation = result['observation'];
  if (typeof observation !== 'string') {
    throw new Error('command tool test result requires observation');
  }
  return { data: JsonValueSchema.parse(result['data']), observation };
}

function ptyScreen(revision: number, text: string) {
  return PtyTerminalScreenProjectionSchema.parse({
    mode: 'pty',
    scope: 'terminal_window',
    revision,
    columns: 80,
    rows: 24,
    active_buffer: 'normal',
    total_buffer_lines: 1,
    window_start_line: 0,
    viewport_start_line: 0,
    scrollback_lines: 0,
    omitted_before_lines: 0,
    cursor: { column: text.length, row: 0 },
    lines: [{ wrapped: false, text, cell_metrics: [], style_runs: [] }],
  });
}

function shellMessage(overrides: {
  readonly observation: string;
  readonly display: CommandToolOutputDisplay;
  readonly presentation?: typeof SHELL_PRESENTATION | null;
}): ToolCallMessage {
  const presentation =
    overrides.presentation === null ? undefined : (overrides.presentation ?? SHELL_PRESENTATION);
  const result = {
    data: {
      status: 'running' as const,
      presentationText: overrides.observation,
      processHandle: HANDLE,
      nextCursor: 2,
      display: overrides.display,
      ...(presentation ? { presentation } : {}),
    },
    observation: `command_control: {"protocol_version":1,"kind":"shell_model_control","status":"running","process_handle":"${HANDLE}","next_cursor":2}\n\noutput:\n${overrides.observation}`,
  };
  return {
    ...createTestToolMessage({
      id: 'command-shell-message',
      content: result.observation,
      metadata: {
        tool_call_id: 'command-shell-call',
        tool_name: 'shell',
        run_id: 'command-run',
        args: { command: 'printf hello', interactive: overrides.display.mode === 'pty' },
        data: JsonValueSchema.parse(result.data),
      },
    }),
    toolPresentation: {
      uiKey: 'shell',
      status: 'success',
      phase: 'complete',
      ...projectCommandExecutionPresentation({
        sourceToolName: 'shell',
        uiKey: 'shell',
        args: { command: 'printf hello', interactive: overrides.display.mode === 'pty' },
        result,
        status: 'success',
        phase: 'complete',
      }),
    },
  };
}

function processMessage(input: {
  readonly id: string;
  readonly action: string;
  readonly result: unknown;
}): ToolCallMessage {
  const args = { process_handle: HANDLE, action: { type: input.action } };
  const result = parseToolResult(input.result);
  return {
    ...createTestToolMessage({
      id: input.id,
      content: result.observation,
      metadata: {
        tool_call_id: `${input.id}-call`,
        tool_name: 'process',
        run_id: 'command-run',
        args,
        data: result.data,
      },
    }),
    toolPresentation: {
      uiKey: 'process',
      status: 'success',
      phase: 'complete',
      ...projectCommandExecutionPresentation({
        sourceToolName: 'process',
        uiKey: 'process',
        args,
        result,
        status: 'success',
        phase: 'complete',
      }),
    },
  };
}

describe('command execution presentation', () => {
  it('未通过 owner admission 的命令生命周期不会中断投影', () => {
    expect(
      projectCommandExecutionPresentation({
        sourceToolName: 'shell',
        uiKey: 'shell',
        toolCallId: 'invalid-shell-call',
        args: { command: '' },
        result: undefined,
        status: 'loading',
        phase: 'start',
      }).data
    ).toEqual({
      kind: 'command_execution_lifecycle',
      source: 'shell',
      state: 'starting',
      toolCallId: 'invalid-shell-call',
      observation: '',
      incomplete: false,
      incompleteReasons: [],
    });

    expect(
      projectCommandExecutionPresentation({
        sourceToolName: 'process',
        uiKey: 'process',
        args: { action: { type: 'poll' } },
        result: undefined,
        status: 'error',
        phase: 'error',
      }).data
    ).toMatchObject({
      kind: 'command_execution_lifecycle',
      source: 'process',
      state: 'failed',
    });

    expect(() =>
      projectCommandExecutionPresentation({
        sourceToolName: 'shell',
        uiKey: 'shell',
        args: { command: '' },
        result: {},
        status: 'success',
        phase: 'complete',
      })
    ).toThrow();
  });

  it('Shell 外层失败在 live 与 reload 中投影为同一 failed 事实，不解析 success result', () => {
    const unregisterPort = registerToolPresentationProjectionPort(COMMAND_PROJECTION_PORT);
    try {
      const conversationId = 'conversation-command-failure';
      const turnId = 'turn-command-failure';
      const toolCallId = 'call-command-failure';
      const args = {
        command: 'linnya-slides render --presentation deck-1',
        interactive: false,
      };
      const error = 'Tool call was cancelled during execution because the run was aborted.';
      const state = createInitialProjectionState({
        id: conversationId,
        title: 'Command failure projection',
        titleOrigin: 'explicit',
        createdAt: 1,
        updatedAt: 1,
        messages: [],
        selectedAgentId: null,
      });
      const decision = createSSEToolCallDecisionEvent(
        'evt-command-failure-decision',
        conversationId,
        turnId,
        'shell',
        toolCallId,
        'start',
        'loading',
        {
          ...PROJECTION_TEST_SCOPE,
          args,
          payload: { args },
        }
      );
      const output = createSSEToolOutputEvent(
        'evt-command-failure-output',
        conversationId,
        turnId,
        'shell',
        toolCallId,
        { status: 'error', observation: error, error },
        PROJECTION_TEST_SCOPE
      );

      expect(reduceEvent(state, decision).success).toBe(true);
      expect(reduceEvent(state, output).success).toBe(true);
      const live = state.conversation.messages[0];
      expect(live?.type).toBe('tool_calls');
      if (!live || live.type !== 'tool_calls') throw new Error('Expected failed Shell message');
      expect(live.toolPresentation).toMatchObject({
        uiKey: 'shell',
        status: 'error',
        phase: 'error',
        data: {
          kind: 'command_execution',
          source: 'shell',
          state: 'failed',
          command: args.command,
        },
      });

      const dto = ConversationUiMessageSchema.parse({
        message_id: live.id,
        conversation_id: conversationId,
        turn_id: turnId,
        run_id: PROJECTION_TEST_SCOPE.run_id,
        role: 'assistant',
        message_type: 'tool_calls',
        sort_seq: 1,
        timestamp: output.timestamp,
        content: live.content,
        payload: {
          tool_call_id: live.metadata.tool_call_id,
          tool_name: live.metadata.tool_name,
          status: live.metadata.status,
          phase: live.metadata.phase,
          args: live.metadata.args,
          error: live.metadata.error,
          started_at: live.metadata.started_at,
          completed_at: live.metadata.completed_at,
        },
        merge_key: live.id,
        presentation: null,
      });
      const reloaded = mapUiMessageDtoToConversationMessage(dto);
      expect(reloaded.type).toBe('tool_calls');
      if (reloaded.type !== 'tool_calls') throw new Error('Expected reloaded Shell message');
      expect(reloaded.toolPresentation).toEqual(live.toolPresentation);
    } finally {
      unregisterPort();
    }
  });

  it('失败的 process 控制调用保留独立错误消息，不聚合进原 Shell 卡片', () => {
    const shell = shellMessage({ observation: 'running', display: PIPE_DISPLAY });
    const args = { process_handle: HANDLE, action: { type: 'poll' } };
    const error = 'Tool call was cancelled before execution because the run was aborted.';
    const failedProcess: ToolCallMessage = {
      ...createTestToolMessage({
        id: 'command-failed-process',
        content: error,
        metadata: {
          tool_name: 'process',
          run_id: 'command-run',
          status: 'error',
          args,
          error,
        },
      }),
      toolPresentation: {
        uiKey: 'process',
        status: 'error',
        phase: 'error',
        ...projectCommandExecutionPresentation({
          sourceToolName: 'process',
          uiKey: 'process',
          args,
          result: { error, observation: error },
          status: 'error',
          phase: 'error',
        }),
      },
    };

    const aggregated = aggregateCommandExecutionMessages([shell, failedProcess]);
    expect(aggregated.map(message => message.id)).toEqual([shell.id, failedProcess.id]);
    expect(failedProcess.toolPresentation?.data).toMatchObject({
      kind: 'command_execution',
      source: 'process',
      effect: 'failed',
      state: 'failed',
    });
  });

  it('write/resize accepted 只更新控制事实，poll 才更新原命令输出', () => {
    const original = shellMessage({ observation: 'stdout:\nhello', display: PIPE_DISPLAY });
    const write = processMessage({
      id: 'command-write-message',
      action: 'write',
      result: {
        data: {
          status: 'accepted',
          audit_status: 'incomplete',
          presentationText: 'Input accepted.',
        },
        observation: `command_control: {"protocol_version":1,"kind":"process_model_control","process_handle":"${HANDLE}","status":"accepted"}\n\noutput:\nInput accepted.`,
      },
    });
    const resize = processMessage({
      id: 'command-resize-message',
      action: 'resize',
      result: {
        data: { status: 'accepted', presentationText: 'Resize accepted.' },
        observation: `command_control: {"protocol_version":1,"kind":"process_model_control","process_handle":"${HANDLE}","status":"accepted"}\n\noutput:\nResize accepted.`,
      },
    });

    const afterControls = aggregateCommandExecutionMessages([original, write, resize]);
    expect(afterControls).toHaveLength(1);
    expect(requireTestToolMessage(afterControls[0]).toolPresentation?.data).toMatchObject({
      observation: 'stdout:\nhello',
      display: PIPE_DISPLAY,
      lastProcessAction: 'resize',
      executionFacts: { audit_status: 'incomplete' },
    });

    const poll = processMessage({
      id: 'command-poll-message',
      action: 'poll',
      result: {
        data: {
          status: 'running',
          presentationText: 'stdout:\nhello world',
          nextCursor: 4,
          display: PIPE_DISPLAY,
        },
        observation: `command_control: {"protocol_version":1,"kind":"process_model_control","process_handle":"${HANDLE}","status":"running","next_cursor":4}\n\noutput:\nstdout:\nhello world`,
      },
    });
    const afterPoll = aggregateCommandExecutionMessages([original, write, resize, poll]);
    expect(afterPoll).toHaveLength(1);
    expect(requireTestToolMessage(afterPoll[0]).toolPresentation?.data).toMatchObject({
      observation: 'stdout:\nhello world',
      nextCursor: 4,
      lastProcessAction: 'poll',
    });
  });

  it('同一 handle 不跨 run 聚合，窗口缺少 shell 时保留 process 卡片', () => {
    const shell = shellMessage({ observation: 'running', display: PIPE_DISPLAY });
    const poll = processMessage({
      id: 'other-run-poll',
      action: 'poll',
      result: {
        data: {
          status: 'running',
          presentationText: 'other',
          nextCursor: 3,
          display: PIPE_DISPLAY,
        },
        observation: `command_control: {"protocol_version":1,"kind":"process_model_control","process_handle":"${HANDLE}","status":"running","next_cursor":3}\n\noutput:\nother`,
      },
    });
    const otherRunPoll: ToolCallMessage = {
      ...poll,
      metadata: { ...poll.metadata, run_id: 'other-command-run' },
    };
    expect(aggregateCommandExecutionMessages([shell, otherRunPoll])).toHaveLength(2);
    expect(aggregateCommandExecutionMessages([poll])).toEqual([poll]);
  });

  it('被拒绝的 process 动作把审计失败合并回原 Shell 卡片', () => {
    const shell = shellMessage({ observation: 'running', display: PIPE_DISPLAY });
    const rejected = processMessage({
      id: 'command-rejected-write',
      action: 'write',
      result: {
        data: {
          status: 'rejected',
          code: 'stdin_closed',
          audit_status: 'incomplete',
          presentationText: 'Input is closed.',
        },
        observation: 'Input is closed.',
      },
    });

    const aggregated = aggregateCommandExecutionMessages([shell, rejected]);
    expect(aggregated).toHaveLength(1);
    expect(requireTestToolMessage(aggregated[0]).toolPresentation?.data).toMatchObject({
      state: 'running',
      lastProcessAction: 'write',
      lastProcessRejectionCode: 'stdin_closed',
      executionFacts: { audit_status: 'incomplete' },
    });
  });

  it('PTY 多轮 observation 后的终态无新 screen 时保留最近屏幕与最新终态事实', () => {
    const originalScreen = ptyScreen(7, 'old output');
    const nextScreen = ptyScreen(8, 'completed output');
    const original = shellMessage({
      observation: 'old output',
      display: {
        mode: 'pty',
        coverage: 'complete',
        outputPhase: 'open',
        textProjection: 'available',
        screen: originalScreen,
      },
    });
    const outputPoll = processMessage({
      id: 'command-new-screen-poll',
      action: 'poll',
      result: {
        data: {
          status: 'running',
          presentationText: 'completed output',
          nextCursor: 8,
          display: {
            mode: 'pty',
            coverage: 'complete',
            outputPhase: 'open',
            textProjection: 'available',
            screen: nextScreen,
          },
        },
        observation: `command_control: {"protocol_version":1,"kind":"process_model_control","process_handle":"${HANDLE}","status":"running","next_cursor":8}\n\noutput:\ncompleted output`,
      },
    });
    const terminalPoll = processMessage({
      id: 'command-terminal-poll',
      action: 'poll',
      result: {
        data: {
          status: 'completed',
          presentationText: '(no output)',
          display: {
            mode: 'pty',
            coverage: 'omitted',
            outputPhase: 'closed',
            textProjection: 'failed',
          },
          terminal: { outcome: 'exited', exitCode: 0, signal: null },
          presentation: {
            protocol_version: 1,
            kind: 'command_execution_presentation_facts',
            timing: {
              status: 'started',
              started_at_ms: 100,
              settled_at_ms: 240,
            },
          },
        },
        observation: `command_control: {"protocol_version":1,"kind":"process_model_control","process_handle":"${HANDLE}","status":"completed"}\n\noutput:\n(no output)`,
      },
    });

    const aggregated = aggregateCommandExecutionMessages([original, outputPoll, terminalPoll]);
    expect(aggregated).toHaveLength(1);
    expect(requireTestToolMessage(aggregated[0]).toolPresentation?.data).toMatchObject({
      state: 'completed',
      observation: '(no output)',
      display: {
        mode: 'pty',
        coverage: 'omitted',
        outputPhase: 'closed',
        textProjection: 'failed',
        screen: nextScreen,
      },
      terminal: { outcome: 'exited', exitCode: 0, signal: null },
      executionFacts: {
        timing: { status: 'started', started_at_ms: 100, settled_at_ms: 240 },
        permission: { source: 'allow_once' },
      },
      incomplete: true,
      lastProcessAction: 'poll',
    });
  });

  it('PTY 只按 host 的 cell metric/style DTO 分段，不解释控制序列或猜宽字符宽度', () => {
    const screen = PtyTerminalScreenProjectionSchema.parse({
      mode: 'pty',
      scope: 'viewport',
      revision: 2,
      columns: 8,
      rows: 1,
      active_buffer: 'normal',
      total_buffer_lines: 1,
      window_start_line: 0,
      viewport_start_line: 0,
      scrollback_lines: 0,
      omitted_before_lines: 0,
      cursor: { column: 2, row: 0 },
      lines: [
        {
          wrapped: false,
          text: '你A',
          cell_metrics: [{ column: 0, text_offset: 0, text_length: 1, display_width: 2 }],
          style_runs: [
            {
              start_column: 0,
              end_column: 2,
              style: { foreground: { mode: 'rgb', value: 0xff0000 }, bold: true },
            },
          ],
        },
      ],
    });
    expect(
      projectPtyTerminalLineSegments({
        line: screen.lines[0]!,
        cursorColumn: screen.cursor.column,
      })
    ).toEqual([
      {
        text: '你',
        cursor: false,
        style: { color: 'rgb(255, 0, 0)', fontWeight: '700' },
      },
      { text: 'A', cursor: true, style: {} },
    ]);
  });

  it('PTY 内部空白与行尾空白光标不会卡住或消失', () => {
    const line = PtyTerminalScreenProjectionSchema.parse({
      mode: 'pty',
      scope: 'viewport',
      revision: 3,
      columns: 8,
      rows: 1,
      active_buffer: 'normal',
      total_buffer_lines: 1,
      window_start_line: 0,
      viewport_start_line: 0,
      scrollback_lines: 0,
      omitted_before_lines: 0,
      cursor: { column: 6, row: 0 },
      lines: [
        {
          wrapped: false,
          text: 'AB',
          cell_metrics: [{ column: 1, text_offset: 1, text_length: 0, display_width: 2 }],
          style_runs: [],
        },
      ],
    }).lines[0]!;

    expect(projectPtyTerminalLineSegments({ line, cursorColumn: 6 })).toEqual([
      { text: 'A  B  ', cursor: false, style: {} },
      { text: ' ', cursor: true, style: {} },
    ]);
  });

  it('省略与 projection failure 保留为明确 incomplete，而不是把预览冒充全文', () => {
    const display: CommandToolOutputDisplay = {
      mode: 'pipe',
      coverage: 'omitted',
      outputPhase: 'closed',
      textProjection: 'failed',
    };
    const message = shellMessage({
      observation: 'stdout:\nlatest tail',
      display,
      presentation: null,
    });
    expect(message.toolPresentation?.data).toMatchObject({
      incomplete: true,
      incompleteReasons: ['retained_window_omitted', 'text_projection_failed'],
      display,
    });
    expect(message.toolPresentation?.data).not.toHaveProperty('executionFacts');
    expect(message.toolPresentation?.data).not.toMatchObject({
      observation: expect.stringContaining('command_control:'),
    });
  });
});
