import { describe, expect, it } from 'vitest';
import { ConversationUiMessageSchema } from '@app/schemas';
import type { UiMessagesWindowReadyDto } from '@/domains/conversation/message-window/definitions/uiMessagesDto';
import { projectCommandExecutionWindowForValidation } from './projectCommandExecutionWindowForValidation';

const PROCESS_HANDLE = 'command_process_123e4567-e89b-42d3-a456-426614174000';
const PIPE_DISPLAY = {
  mode: 'pipe',
  coverage: 'complete',
  outputPhase: 'closed',
  textProjection: 'available',
} as const;

function commandWindowDto(): UiMessagesWindowReadyDto {
  const shellResult = {
    data: {
      status: 'running',
      presentationText: 'stdout:\nstarted',
      processHandle: PROCESS_HANDLE,
      nextCursor: 1,
      display: { ...PIPE_DISPLAY, outputPhase: 'open' },
    },
    observation: `command_control: {"protocol_version":1,"kind":"shell_model_control","status":"running","process_handle":"${PROCESS_HANDLE}","next_cursor":1}\n\noutput:\nstdout:\nstarted`,
  };
  const processResult = {
    data: {
      status: 'completed',
      presentationText: 'stdout:\nstarted\nfinished',
      display: PIPE_DISPLAY,
      terminal: { outcome: 'exited', exitCode: 0, signal: null },
    },
    observation: `command_control: {"protocol_version":1,"kind":"process_model_control","process_handle":"${PROCESS_HANDLE}","status":"completed","terminal":{"outcome":"exited","exitCode":0,"signal":null}}\n\noutput:\nstdout:\nstarted\nfinished`,
  };
  const messages = [
    ConversationUiMessageSchema.parse({
      message_id: 'command-message-shell',
      conversation_id: 'conversation-command-window',
      turn_id: 'turn-command-window',
      run_id: 'run-command-window',
      role: 'assistant',
      message_type: 'tool_calls',
      sort_seq: 1,
      timestamp: 10,
      content: JSON.stringify(shellResult),
      payload: {
        tool_call_id: 'call-shell',
        tool_name: 'shell',
        status: 'success',
        phase: 'complete',
        args: { command: 'printf started; printf finished', cwd: '/tmp/work', interactive: false },
        data: shellResult.data,
        started_at: 1,
        completed_at: 10,
      },
      merge_key: 'command-message-shell',
      presentation: null,
    }),
    ConversationUiMessageSchema.parse({
      message_id: 'command-message-process',
      conversation_id: 'conversation-command-window',
      turn_id: 'turn-command-window',
      run_id: 'run-command-window',
      role: 'assistant',
      message_type: 'tool_calls',
      sort_seq: 2,
      timestamp: 20,
      content: JSON.stringify(processResult),
      payload: {
        tool_call_id: 'call-process',
        tool_name: 'process',
        status: 'success',
        phase: 'complete',
        args: { process_handle: PROCESS_HANDLE, action: { type: 'wait' } },
        data: processResult.data,
        started_at: 11,
        completed_at: 20,
      },
      merge_key: 'command-message-process',
      presentation: null,
    }),
  ];
  return {
    success: true,
    conversation_id: 'conversation-command-window',
    messages,
    citation_dependencies: {},
    has_more_before: false,
    has_more_after: false,
    prev_cursor: 1,
    next_cursor: 2,
    revision: 2,
  };
}

describe('command execution window validation fixture', () => {
  it('把 shell/process durable rows 投影并聚合为一张完成态命令卡', () => {
    const projection = projectCommandExecutionWindowForValidation(commandWindowDto());

    expect(projection.mappedMessages).toHaveLength(2);
    expect(projection.mappedMessages.map(message => (
      message.type === 'tool_calls' ? message.toolPresentation?.data : null
    ))).toMatchObject([
      { kind: 'command_execution', source: 'shell', state: 'running' },
      { kind: 'command_execution', source: 'process', state: 'completed' },
    ]);

    expect(projection.aggregatedMessages).toHaveLength(1);
    const command = projection.aggregatedMessages[0];
    expect(command?.type).toBe('tool_calls');
    if (!command || command.type !== 'tool_calls') throw new Error('Expected one command tool message');
    expect(command.toolPresentation?.data).toMatchObject({
      kind: 'command_execution',
      source: 'shell',
      state: 'completed',
      command: 'printf started; printf finished',
      cwd: '/tmp/work',
      processHandle: PROCESS_HANDLE,
      observation: 'stdout:\nstarted\nfinished',
      terminal: { outcome: 'exited', exitCode: 0, signal: null },
      lastProcessAction: 'wait',
    });
    expect(command.toolPresentation?.data).not.toMatchObject({
      observation: expect.stringContaining('command_control:'),
    });
  });
});
