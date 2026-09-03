import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';

import {
  ProcessAgentModelControlV1Schema,
  ShellAgentModelControlV1Schema,
} from '@app/schemas/commands';
import type { SerializableJsonValue } from '@linnlabs/linnkit/contracts';
import type { CanonicalInferenceEvent, CanonicalInferencePort } from '@linnlabs/linnkit/ports';

import { parseCommandToolModelControlLine } from '../../../../../src/domains/commands';
import {
  answerEvents,
  requireToolMessageText,
  startInferenceEvent,
  toolCallEvents,
} from '../../harness/deterministicInferenceEvents';

export const AGENT_PTY_SHELL_TOOL_CALL_ID = 'call-agent-pty-shell';
const SUBMIT_TOOL_CALL_ID = 'call-agent-pty-submit';
const RESIZE_TOOL_CALL_ID = 'call-agent-pty-resize';
const EOF_TOOL_CALL_ID = 'call-agent-pty-eof';
const TERMINAL_REPLAY_TOOL_CALL_ID = 'call-agent-pty-terminal-replay';
const MAX_OBSERVATION_WAITS_PER_PHASE = 4;
const OBSERVATION_WAIT_TIMEOUT_MS = 1_000;

type AgentPtyPhase =
  | 'launch'
  | 'shell_result'
  | 'observe_ready'
  | 'submit_result'
  | 'observe_submit'
  | 'resize_result'
  | 'observe_resize'
  | 'eof_result'
  | 'observe_terminal'
  | 'terminal_replay_result'
  | 'done';

function requireOutputBody(observation: string): string {
  const marker = '\n\noutput:\n';
  const markerIndex = observation.indexOf(marker);
  assert.notEqual(markerIndex, -1, 'command model observation must contain an output body');
  return observation.slice(markerIndex + marker.length);
}

function assertModelMessageDoesNotContainRendererScreen(message: string): void {
  for (const rendererOnlyField of ['cell_metrics', 'style_runs', 'active_buffer']) {
    assert(
      !message.includes(rendererOnlyField),
      `model message must not contain renderer-only field ${rendererOnlyField}`,
    );
  }
}

function assertSafePtyProjection(output: string): void {
  assert(output.includes('PTY_SCREEN_SAFE_中'), 'Agent PTY projection lost the safe screen marker');
  for (const forbidden of [
    'PC53_PTY_TITLE_SECRET',
    'PC53_PTY_CLIPBOARD_SECRET',
    'pc53.invalid',
    'PC53_PTY_NOTIFICATION_SECRET',
    'PC53_PTY_IMAGE_SECRET',
    'PC53_PTY_DCS_SECRET',
    'ERASED_RED_TEXT',
  ]) {
    assert(!output.includes(forbidden), `Agent PTY projection leaked ${forbidden}`);
  }
  assert(!output.includes('\u001b'), 'Agent PTY projection must not expose escape controls');
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
  throw new Error('external PTY process observation was not published before submit');
}

/** 只替代外部模型；生产工具必须自己提供真实 handle、cursor、PTY 输出和终态。 */
export function createDeterministicAgentPtyInferencePort(input: {
  readonly command: string;
  readonly submittedValue: string;
  readonly expectedSize: string;
  readonly observationReadyPath: string;
}): CanonicalInferencePort & {
  assertComplete(): void;
  toolCallIds(): readonly string[];
  observationWaitCounts(): Readonly<{
    ready: number;
    submit: number;
    resize: number;
    terminal: number;
  }>;
} {
  let callCount = 0;
  let phase: AgentPtyPhase = 'launch';
  let processHandle: string | undefined;
  let observationCursor: number | undefined;
  let lastToolCallId: string | undefined;
  let observedNaturalEofMarker = false;
  const issuedToolCallIds: string[] = [];
  const waitCounts = { ready: 0, submit: 0, resize: 0, terminal: 0 };

  function requireProcessHandle(): string {
    if (!processHandle) throw new Error('PTY process handle is unavailable');
    return processHandle;
  }

  function requireObservationCursor(): number {
    if (observationCursor === undefined) throw new Error('PTY observation cursor is unavailable');
    return observationCursor;
  }

  return {
    async *stream(request) {
      callCount += 1;
      yield startInferenceEvent(request);

      const issueTool = (request: {
        readonly id: string;
        readonly name: 'shell' | 'process';
        readonly arguments: Readonly<Record<string, SerializableJsonValue>>;
        readonly nextPhase: AgentPtyPhase;
      }): readonly CanonicalInferenceEvent[] => {
        assert(!issuedToolCallIds.includes(request.id), `duplicate tool call id: ${request.id}`);
        issuedToolCallIds.push(request.id);
        lastToolCallId = request.id;
        phase = request.nextPhase;
        return toolCallEvents({
          id: request.id,
          name: request.name,
          arguments: request.arguments,
        });
      };
      const issueWait = (
        target: 'ready' | 'submit' | 'resize' | 'terminal',
      ): readonly CanonicalInferenceEvent[] => {
        waitCounts[target] += 1;
        assert(
          waitCounts[target] <= MAX_OBSERVATION_WAITS_PER_PHASE,
          `${target} output did not stabilize within the bounded observation loop`,
        );
        return issueTool({
          id: `call-agent-pty-${target}-wait-${waitCounts[target]}`,
          name: 'process',
          arguments: {
            process_handle: requireProcessHandle(),
            action: {
              type: 'wait',
              cursor: requireObservationCursor(),
              wait_timeout_ms: OBSERVATION_WAIT_TIMEOUT_MS,
            },
          },
          nextPhase: target === 'ready'
            ? 'observe_ready'
            : target === 'submit'
              ? 'observe_submit'
              : target === 'resize'
                ? 'observe_resize'
                : 'observe_terminal',
        });
      };

      if (phase === 'launch') {
        yield* issueTool({
          id: AGENT_PTY_SHELL_TOOL_CALL_ID,
          name: 'shell',
          arguments: {
            command: input.command,
            interactive: true,
            initial_wait_ms: 250,
            hard_timeout_seconds: 30,
          },
          nextPhase: 'shell_result',
        });
        return;
      }

      if (phase === 'shell_result') {
        const message = requireToolMessageText(request.messages, AGENT_PTY_SHELL_TOOL_CALL_ID);
        assertModelMessageDoesNotContainRendererScreen(message);
        const shell = ShellAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(message),
        );
        assert.equal(
          shell.status,
          'running',
          `interactive shell must remain running; tool message=${message}`,
        );
        if (shell.status !== 'running') throw new Error('interactive shell must remain running');
        const output = requireOutputBody(message);
        assert(output.includes('terminal:') || output.includes('(no output)'));
        assert(!output.includes('stdout:'));
        assert(!output.includes('stderr:'));
        processHandle = shell.process_handle;
        observationCursor = shell.next_cursor;
        if (!output.includes('PTY_READY:true:true')) {
          yield* issueWait('ready');
          return;
        }
        assertSafePtyProjection(output);
        await waitForExternalObservation(input.observationReadyPath);
        yield* issueTool({
          id: SUBMIT_TOOL_CALL_ID,
          name: 'process',
          arguments: {
            process_handle: processHandle,
            action: { type: 'submit', input: input.submittedValue },
          },
          nextPhase: 'submit_result',
        });
        return;
      }

      if (phase === 'observe_ready') {
        if (!lastToolCallId) throw new Error('ready observation tool call is unavailable');
        const message = requireToolMessageText(request.messages, lastToolCallId);
        assertModelMessageDoesNotContainRendererScreen(message);
        const observed = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(message),
        );
        assert.equal(observed.status, 'running');
        if (observed.status !== 'running') throw new Error('ready wait must remain running');
        assert.equal(observed.process_handle, processHandle);
        observationCursor = observed.next_cursor;
        const output = requireOutputBody(message);
        if (!output.includes('PTY_READY:true:true')) {
          yield* issueWait('ready');
          return;
        }
        assertSafePtyProjection(output);
        await waitForExternalObservation(input.observationReadyPath);
        yield* issueTool({
          id: SUBMIT_TOOL_CALL_ID,
          name: 'process',
          arguments: {
            process_handle: processHandle,
            action: { type: 'submit', input: input.submittedValue },
          },
          nextPhase: 'submit_result',
        });
        return;
      }

      if (phase === 'submit_result') {
        const submitted = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(
            requireToolMessageText(request.messages, SUBMIT_TOOL_CALL_ID),
          ),
        );
        assert.equal(submitted.status, 'accepted');
        assert.equal(submitted.process_handle, processHandle);
        yield* issueWait('submit');
        return;
      }

      if (phase === 'observe_submit') {
        if (!lastToolCallId) throw new Error('submit observation tool call is unavailable');
        const message = requireToolMessageText(request.messages, lastToolCallId);
        assertModelMessageDoesNotContainRendererScreen(message);
        const observed = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(message),
        );
        assert.equal(observed.status, 'running');
        if (observed.status !== 'running') throw new Error('submit wait must remain running');
        assert.equal(observed.process_handle, processHandle);
        observationCursor = observed.next_cursor;
        if (!requireOutputBody(message).includes(`SUBMIT_OK:${input.submittedValue}`)) {
          yield* issueWait('submit');
          return;
        }
        yield* issueTool({
          id: RESIZE_TOOL_CALL_ID,
          name: 'process',
          arguments: {
            process_handle: processHandle,
            action: { type: 'resize', columns: 100, rows: 31 },
          },
          nextPhase: 'resize_result',
        });
        return;
      }

      if (phase === 'resize_result') {
        const resized = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(
            requireToolMessageText(request.messages, RESIZE_TOOL_CALL_ID),
          ),
        );
        assert.equal(resized.status, 'accepted');
        assert.equal(resized.process_handle, processHandle);
        yield* issueWait('resize');
        return;
      }

      if (phase === 'observe_resize') {
        if (!lastToolCallId) throw new Error('resize observation tool call is unavailable');
        const message = requireToolMessageText(request.messages, lastToolCallId);
        assertModelMessageDoesNotContainRendererScreen(message);
        const observed = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(message),
        );
        assert.equal(observed.status, 'running');
        if (observed.status !== 'running') throw new Error('resize wait must remain running');
        assert.equal(observed.process_handle, processHandle);
        observationCursor = observed.next_cursor;
        if (!requireOutputBody(message).includes(input.expectedSize)) {
          yield* issueWait('resize');
          return;
        }
        yield* issueTool({
          id: EOF_TOOL_CALL_ID,
          name: 'process',
          arguments: {
            process_handle: processHandle,
            action: { type: 'eof' },
          },
          nextPhase: 'eof_result',
        });
        return;
      }

      if (phase === 'eof_result') {
        const eof = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(
            requireToolMessageText(request.messages, EOF_TOOL_CALL_ID),
          ),
        );
        assert.equal(eof.status, 'accepted');
        assert.equal(eof.process_handle, processHandle);
        yield* issueWait('terminal');
        return;
      }

      if (phase === 'observe_terminal') {
        if (!lastToolCallId) throw new Error('terminal observation tool call is unavailable');
        const message = requireToolMessageText(request.messages, lastToolCallId);
        assertModelMessageDoesNotContainRendererScreen(message);
        const observed = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(message),
        );
        assert.equal(observed.process_handle, processHandle);
        if (requireOutputBody(message).includes('PTY_EOF_NATURAL_EXIT')) {
          observedNaturalEofMarker = true;
        }
        if (observed.status === 'running') {
          observationCursor = observed.next_cursor;
          yield* issueWait('terminal');
          return;
        }
        assert.equal(observed.status, 'completed');
        if (observed.status !== 'completed') throw new Error('PTY EOF must settle naturally');
        assert.equal(observed.terminal.outcome, 'exited');
        if (observed.terminal.outcome !== 'exited') {
          throw new Error('PTY EOF must not be projected as cancellation');
        }
        assert.equal(observed.terminal.exitCode, 0);
        assert(observedNaturalEofMarker, 'terminal observations never exposed the natural EOF marker');
        yield* issueTool({
          id: TERMINAL_REPLAY_TOOL_CALL_ID,
          name: 'process',
          arguments: {
            process_handle: processHandle,
            action: { type: 'poll', cursor: observationCursor },
          },
          nextPhase: 'terminal_replay_result',
        });
        return;
      }

      if (phase === 'terminal_replay_result') {
        const replayed = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(
            requireToolMessageText(request.messages, TERMINAL_REPLAY_TOOL_CALL_ID),
          ),
        );
        assert.equal(replayed.status, 'completed');
        if (replayed.status !== 'completed') throw new Error('terminal replay must stay complete');
        assert.equal(replayed.process_handle, processHandle);
        assert.equal(replayed.terminal.outcome, 'exited');
        if (replayed.terminal.outcome !== 'exited') {
          throw new Error('terminal replay must preserve natural exit');
        }
        assert.equal(replayed.terminal.exitCode, 0);
        phase = 'done';
        yield* answerEvents('交互命令已提交输入、调整终端尺寸，并在 EOF 后自然退出。');
        return;
      }

      throw new Error(`unexpected deterministic model call ${callCount} in phase ${phase}`);
    },

    assertComplete(): void {
      assert.equal(phase, 'done', 'graph must consume the complete PTY interaction chain');
      assert(issuedToolCallIds.length >= 8, 'PTY chain must execute every required action');
      assert(issuedToolCallIds.length <= 21, 'PTY observation loop must remain bounded');
    },

    toolCallIds(): readonly string[] {
      return Object.freeze([...issuedToolCallIds]);
    },

    observationWaitCounts() {
      return Object.freeze({ ...waitCounts });
    },
  };
}
