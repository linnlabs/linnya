import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';

import {
  ProcessAgentModelControlV1Schema,
  ShellAgentModelControlV1Schema,
} from '@app/schemas/commands';
import type { CanonicalInferencePort } from 'linnkit/ports';

import { parseCommandToolModelControlLine } from '../../../../../src/domains/commands';
import {
  answerEvents,
  requireToolMessageText,
  startInferenceEvent,
  toolCallEvents,
} from '../../harness/deterministicInferenceEvents';

const SHELL_TOOL_CALL_ID = 'call-agent-process-shell';
const WAIT_TOOL_CALL_ID = 'call-agent-process-wait';
const QUIET_WAIT_TOOL_CALL_ID = 'call-agent-process-quiet-wait';
const CANCEL_TOOL_CALL_ID = 'call-agent-process-cancel';
const TERMINAL_REPLAY_TOOL_CALL_ID = 'call-agent-process-terminal-replay';

function requireOutputBody(observation: string): string {
  const marker = '\n\noutput:\n';
  const markerIndex = observation.indexOf(marker);
  assert.notEqual(markerIndex, -1, 'command model observation must contain an output body');
  return observation.slice(markerIndex + marker.length);
}

async function waitForExternalObservation(filePath: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
      return;
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('external process-tree observation was not published before cancel');
}

/** 只替代外部模型；handle、cursor 和终态均必须来自前一轮真实工具结果。 */
export function createDeterministicAgentProcessInferencePort(input: {
  readonly command: string;
  readonly expectedStart: string;
  readonly expectedTick: string;
  readonly expectedInteractionPrompt: string;
  readonly expectedInteractionStdin: string;
  readonly observationReadyPath: string;
  readonly replayTerminalHandle: boolean;
}): CanonicalInferencePort & { assertComplete(): void } {
  let callCount = 0;
  let shellOutput = '';

  return {
    async *stream(request) {
      callCount += 1;
      yield startInferenceEvent(request);
      if (callCount === 1) {
        yield* toolCallEvents({
          id: SHELL_TOOL_CALL_ID,
          name: 'shell',
          arguments: {
            command: input.command,
            initial_wait_ms: 250,
            hard_timeout_seconds: 30,
          },
        });
        return;
      }

      if (callCount === 2) {
        const shellMessage = requireToolMessageText(request.messages, SHELL_TOOL_CALL_ID);
        const shell = ShellAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(shellMessage),
        );
        assert.equal(
          shell.status,
          'running',
          `shell must remain running; tool message=${shellMessage}`,
        );
        if (shell.status !== 'running') throw new Error('shell must still be running');
        shellOutput = requireOutputBody(shellMessage);
        assert(
          shellOutput.includes(input.expectedStart),
          `shell did not publish the expected start marker: ${shellMessage}`,
        );
        yield* toolCallEvents({
          id: WAIT_TOOL_CALL_ID,
          name: 'process',
          arguments: {
            process_handle: shell.process_handle,
            action: {
              type: 'wait',
              cursor: shell.next_cursor,
              wait_timeout_ms: 2_000,
            },
          },
        });
        return;
      }

      if (callCount === 3) {
        const waitMessage = requireToolMessageText(request.messages, WAIT_TOOL_CALL_ID);
        const waited = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(waitMessage),
        );
        assert.equal(
          waited.status,
          'running',
          `process wait must remain running; tool message=${waitMessage}`,
        );
        if (waited.status !== 'running') throw new Error('process wait must remain running');
        const waitOutput = requireOutputBody(waitMessage);
        assert(
          `${shellOutput}\n${waitOutput}`.includes(input.expectedTick),
          `shell/wait did not publish the expected tick marker: ${waitMessage}`,
        );
        assert(
          `${shellOutput}\n${waitOutput}`.includes(input.expectedInteractionPrompt),
          `prompt-like output was not observed as ordinary command text: ${waitMessage}`,
        );
        assert(
          `${shellOutput}\n${waitOutput}`.includes(input.expectedInteractionStdin),
          `ordinary pipe child did not observe stdin EOF: ${waitMessage}`,
        );
        yield* toolCallEvents({
          id: QUIET_WAIT_TOOL_CALL_ID,
          name: 'process',
          arguments: {
            process_handle: waited.process_handle,
            action: {
              type: 'wait',
              cursor: waited.next_cursor,
              wait_timeout_ms: 500,
            },
          },
        });
        return;
      }

      if (callCount === 4) {
        const quietWaitMessage = requireToolMessageText(request.messages, QUIET_WAIT_TOOL_CALL_ID);
        const quietWait = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(quietWaitMessage),
        );
        assert.equal(
          quietWait.status,
          'running',
          `a silent wait must report the real running state: ${quietWaitMessage}`,
        );
        if (quietWait.status !== 'running') throw new Error('silent wait must remain running');
        assert.equal(
          requireOutputBody(quietWaitMessage).trim(),
          '(no output)',
          'a silent wait must not invent an answer or switch execution mode',
        );
        await waitForExternalObservation(input.observationReadyPath);
        yield* toolCallEvents({
          id: CANCEL_TOOL_CALL_ID,
          name: 'process',
          arguments: {
            process_handle: quietWait.process_handle,
            action: { type: 'cancel' },
          },
        });
        return;
      }

      if (callCount === 5) {
        const cancelled = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(
            requireToolMessageText(request.messages, CANCEL_TOOL_CALL_ID),
          ),
        );
        assert.equal(cancelled.status, 'completed');
        if (cancelled.status !== 'completed') throw new Error('cancel must settle the process');
        assert.equal(cancelled.terminal.outcome, 'terminated');
        if (cancelled.terminal.outcome !== 'terminated') {
          throw new Error('cancelled process must have a terminated terminal');
        }
        assert.equal(cancelled.terminal.reason, 'cancelled');
        if (input.replayTerminalHandle) {
          const waited = ProcessAgentModelControlV1Schema.parse(
            parseCommandToolModelControlLine(
              requireToolMessageText(request.messages, WAIT_TOOL_CALL_ID),
            ),
          );
          if (waited.status !== 'running') {
            throw new Error('the last running cursor is required for terminal replay');
          }
          yield* toolCallEvents({
            id: TERMINAL_REPLAY_TOOL_CALL_ID,
            name: 'process',
            arguments: {
              process_handle: cancelled.process_handle,
              action: {
                type: 'poll',
                cursor: waited.next_cursor,
              },
            },
          });
          return;
        }
        yield* answerEvents('长命令已由用户取消并完整收口。');
        return;
      }

      if (callCount === 6 && input.replayTerminalHandle) {
        const replayed = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(
            requireToolMessageText(request.messages, TERMINAL_REPLAY_TOOL_CALL_ID),
          ),
        );
        assert.equal(replayed.status, 'completed');
        if (replayed.status !== 'completed') {
          throw new Error('terminal handle replay must remain completed');
        }
        assert.equal(replayed.terminal.outcome, 'terminated');
        if (replayed.terminal.outcome !== 'terminated') {
          throw new Error('terminal handle replay must preserve the terminated terminal');
        }
        assert.equal(replayed.terminal.reason, 'cancelled');
        yield* answerEvents('长命令已由用户取消，终态句柄重放结果保持一致。');
        return;
      }

      throw new Error(`unexpected deterministic model call: ${callCount}`);
    },

    assertComplete(): void {
      assert.equal(
        callCount,
        input.replayTerminalHandle ? 6 : 5,
        'graph must consume all long-process model turns',
      );
    },
  };
}

export const AGENT_PROCESS_TOOL_CALL_IDS = Object.freeze({
  shell: SHELL_TOOL_CALL_ID,
  wait: WAIT_TOOL_CALL_ID,
  quietWait: QUIET_WAIT_TOOL_CALL_ID,
  cancel: CANCEL_TOOL_CALL_ID,
  terminalReplay: TERMINAL_REPLAY_TOOL_CALL_ID,
});
