import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import {
  ProcessAgentModelControlV1Schema,
  ShellAgentModelControlV1Schema,
  type CommandProcessHandle,
} from '@app/schemas/commands';
import type { CanonicalInferencePort } from 'linnkit/ports';

import { parseCommandToolModelControlLine } from '../../../../../src/domains/commands';
import {
  answerEvents,
  requireToolMessageText,
  startInferenceEvent,
  toolCallEvents,
} from '../../harness/deterministicInferenceEvents';

const ROOT_SHELL_TOOL_CALL_ID = 'call-child-agent-root-shell';
const SUBAGENT_TOOL_CALL_ID = 'call-child-agent-subagent';
const CHILD_SHELL_TOOL_CALL_ID = 'call-child-agent-child-shell';
const CHILD_WAIT_TOOL_CALL_ID = 'call-child-agent-child-wait';
const CHILD_CANCEL_TOOL_CALL_ID = 'call-child-agent-child-cancel';
const ROOT_WAIT_TOOL_CALL_ID = 'call-child-agent-root-wait';

function requireOutputBody(observation: string): string {
  const marker = '\n\noutput:\n';
  const markerIndex = observation.indexOf(marker);
  assert.notEqual(markerIndex, -1, 'command model observation must contain an output body');
  return observation.slice(markerIndex + marker.length);
}

async function waitForFile(filePath: string, description: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await fsp.access(filePath);
      return;
    } catch (error: unknown) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`timed out waiting for ${description}`);
}

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const rejectAsAborted = (): void => {
      const error = new Error('conversation deletion aborted the root Agent run');
      error.name = 'AbortError';
      reject(error);
    };
    if (!signal) {
      reject(new Error('root Agent model call did not receive an abort signal'));
      return;
    }
    if (signal.aborted) {
      rejectAsAborted();
      return;
    }
    signal.addEventListener('abort', rejectAsAborted, { once: true });
  });
}

async function publishJson(filePath: string, value: unknown): Promise<void> {
  const pendingPath = `${filePath}.${process.pid}.pending`;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(pendingPath, JSON.stringify(value), 'utf8');
  await fsp.rename(pendingPath, filePath);
}

/**
 * 只替换外部模型。全局调用顺序刻意对应同步 subagent 的生产语义：root 的长命令
 * 已经启动后才进入 child，child 完整退出后 root 才能继续下一次模型调用。
 */
export function createDeterministicChildInferencePort(input: {
  readonly rootCommand: string;
  readonly childCommand: string;
  readonly rootExpectedStart: string;
  readonly rootExpectedTick: string;
  readonly childExpectedStart: string;
  readonly childExpectedTick: string;
  readonly overlapObservedPath: string;
  readonly rootReadyPath: string;
}): CanonicalInferencePort & {
  waitForRootReady(): Promise<CommandProcessHandle>;
  assertAborted(): void;
} {
  let callCount = 0;
  let rootHandle: CommandProcessHandle | undefined;
  let rootCursor = 0;
  let publishRootReady: ((handle: CommandProcessHandle) => void) | undefined;
  const rootReady = new Promise<CommandProcessHandle>((resolve) => {
    publishRootReady = resolve;
  });
  let abortObserved = false;

  return {
    async *stream(request) {
      callCount += 1;
      yield startInferenceEvent(request);

      if (callCount === 1) {
        yield* toolCallEvents({
          id: ROOT_SHELL_TOOL_CALL_ID,
          name: 'shell',
          arguments: {
            command: input.rootCommand,
            initial_wait_ms: 250,
            hard_timeout_seconds: 60,
          },
        });
        return;
      }

      if (callCount === 2) {
        const message = requireToolMessageText(request.messages, ROOT_SHELL_TOOL_CALL_ID);
        const control = ShellAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(message),
        );
        assert.equal(control.status, 'running');
        if (control.status !== 'running') throw new Error('root sibling command must be running');
        assert(requireOutputBody(message).includes(input.rootExpectedStart));
        rootHandle = control.process_handle;
        rootCursor = control.next_cursor;
        yield* toolCallEvents({
          id: SUBAGENT_TOOL_CALL_ID,
          name: 'subagent',
          arguments: {
            description: '运行子命令',
            prompt: '在当前对话目录运行指定的子命令，等待输出后取消，并报告完成。',
            subagent_type: 'general',
          },
        });
        return;
      }

      if (callCount === 3) {
        yield* toolCallEvents({
          id: CHILD_SHELL_TOOL_CALL_ID,
          name: 'shell',
          arguments: {
            command: input.childCommand,
            initial_wait_ms: 250,
            hard_timeout_seconds: 60,
          },
        });
        return;
      }

      if (callCount === 4) {
        const message = requireToolMessageText(request.messages, CHILD_SHELL_TOOL_CALL_ID);
        const control = ShellAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(message),
        );
        assert.equal(control.status, 'running');
        if (control.status !== 'running') throw new Error('child command must be running');
        assert(requireOutputBody(message).includes(input.childExpectedStart));
        yield* toolCallEvents({
          id: CHILD_WAIT_TOOL_CALL_ID,
          name: 'process',
          arguments: {
            process_handle: control.process_handle,
            action: {
              type: 'wait',
              cursor: control.next_cursor,
              wait_timeout_ms: 2_000,
            },
          },
        });
        return;
      }

      if (callCount === 5) {
        const message = requireToolMessageText(request.messages, CHILD_WAIT_TOOL_CALL_ID);
        const control = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(message),
        );
        assert.equal(control.status, 'running');
        if (control.status !== 'running') throw new Error('child wait must remain running');
        assert(requireOutputBody(message).includes(input.childExpectedTick));
        await waitForFile(input.overlapObservedPath, 'external root/child overlap observation');
        yield* toolCallEvents({
          id: CHILD_CANCEL_TOOL_CALL_ID,
          name: 'process',
          arguments: {
            process_handle: control.process_handle,
            action: { type: 'cancel' },
          },
        });
        return;
      }

      if (callCount === 6) {
        const control = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(
            requireToolMessageText(request.messages, CHILD_CANCEL_TOOL_CALL_ID),
          ),
        );
        assert.equal(control.status, 'completed');
        if (control.status !== 'completed') throw new Error('child cancel must settle');
        assert.equal(control.terminal.outcome, 'terminated');
        if (control.terminal.outcome !== 'terminated') {
          throw new Error('child cancelled command must terminate');
        }
        assert.equal(control.terminal.reason, 'cancelled');
        yield* answerEvents('子命令已取消并完成收口。');
        return;
      }

      if (callCount === 7) {
        const subagent = requireToolMessageText(request.messages, SUBAGENT_TOOL_CALL_ID);
        assert(
          subagent.includes('status=completed'),
          'subagent must return the completed child result',
        );
        assert(rootHandle, 'root handle must be captured before subagent');
        yield* toolCallEvents({
          id: ROOT_WAIT_TOOL_CALL_ID,
          name: 'process',
          arguments: {
            process_handle: rootHandle,
            action: {
              type: 'wait',
              cursor: rootCursor,
              wait_timeout_ms: 2_000,
            },
          },
        });
        return;
      }

      if (callCount === 8) {
        const message = requireToolMessageText(request.messages, ROOT_WAIT_TOOL_CALL_ID);
        const control = ProcessAgentModelControlV1Schema.parse(
          parseCommandToolModelControlLine(message),
        );
        assert.equal(control.status, 'running');
        if (control.status !== 'running') {
          throw new Error('child cleanup must not stop the root sibling command');
        }
        assert(requireOutputBody(message).includes(input.rootExpectedTick));
        await publishJson(input.rootReadyPath, {
          version: 1,
          processHandle: control.process_handle,
          nextCursor: control.next_cursor,
        });
        publishRootReady?.(control.process_handle);
        publishRootReady = undefined;
        try {
          await waitForAbort(request.signal);
        } catch (error: unknown) {
          if (error instanceof Error && error.name === 'AbortError') {
            abortObserved = true;
            yield { type: 'failure', kind: 'aborted', code: 'request_aborted', retryable: false };
            return;
          }
          throw error;
        }
      }

      throw new Error(`unexpected production child Agent model call: ${callCount}`);
    },

    waitForRootReady(): Promise<CommandProcessHandle> {
      return rootHandle && callCount >= 8 ? Promise.resolve(rootHandle) : rootReady;
    },

    assertAborted(): void {
      assert.equal(callCount, 8, 'root and child must consume the complete deterministic sequence');
      assert.equal(abortObserved, true, 'conversation deletion must abort the active root model call');
    },
  };
}

export const CHILD_AGENT_TOOL_CALL_IDS = Object.freeze({
  rootShell: ROOT_SHELL_TOOL_CALL_ID,
  subagent: SUBAGENT_TOOL_CALL_ID,
  childShell: CHILD_SHELL_TOOL_CALL_ID,
  childWait: CHILD_WAIT_TOOL_CALL_ID,
  childCancel: CHILD_CANCEL_TOOL_CALL_ID,
  rootWait: ROOT_WAIT_TOOL_CALL_ID,
});
