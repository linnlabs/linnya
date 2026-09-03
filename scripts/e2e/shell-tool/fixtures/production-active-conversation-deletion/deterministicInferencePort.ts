import assert from 'node:assert/strict';

import {
  ShellAgentModelControlV1Schema,
  type CommandProcessHandle,
} from '@app/schemas/commands';
import type { CanonicalInferencePort } from 'linnkit/ports';

import { parseCommandToolModelControlLine } from '../../../../../src/domains/commands';
import {
  requireToolMessageText,
  startInferenceEvent,
  toolCallEvents,
} from '../../harness/deterministicInferenceEvents';

const SHELL_TOOL_CALL_ID = 'call-active-deletion-shell';

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const rejectAsAborted = (): void => {
      const error = new Error('conversation deletion aborted the active Agent run');
      error.name = 'AbortError';
      reject(error);
    };
    if (!signal) {
      reject(new Error('active deletion model call did not receive the Agent run abort signal'));
      return;
    }
    if (signal.aborted) {
      rejectAsAborted();
      return;
    }
    signal.addEventListener('abort', rejectAsAborted, { once: true });
  });
}

/** 测试模型只从真实 shell 控制首行取得 opaque handle，随后保持 Agent run 活跃直到 HTTP 删除。 */
export function createDeterministicDeletionInferencePort(input: {
  readonly command: string;
}): CanonicalInferencePort & {
  waitForProcessHandle(): Promise<CommandProcessHandle>;
  assertAborted(): void;
} {
  let callCount = 0;
  let capturedHandle: CommandProcessHandle | undefined;
  let publishHandle: ((handle: CommandProcessHandle) => void) | undefined;
  const handlePromise = new Promise<CommandProcessHandle>((resolve) => {
    publishHandle = resolve;
  });
  let abortObserved = false;

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
      if (callCount !== 2) {
        throw new Error(`unexpected active-deletion model call: ${callCount}`);
      }

      const control = ShellAgentModelControlV1Schema.parse(
        parseCommandToolModelControlLine(
          requireToolMessageText(request.messages, SHELL_TOOL_CALL_ID),
        ),
      );
      assert.equal(control.status, 'running');
      if (control.status !== 'running') throw new Error('deletion fixture shell must be running');
      capturedHandle = control.process_handle;
      publishHandle?.(capturedHandle);
      publishHandle = undefined;
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
    },

    waitForProcessHandle(): Promise<CommandProcessHandle> {
      return capturedHandle ? Promise.resolve(capturedHandle) : handlePromise;
    },

    assertAborted(): void {
      assert.equal(callCount, 2, 'deletion must interrupt the model after the running shell result');
      assert.equal(abortObserved, true, 'active Agent model call must observe deletion abort');
    },
  };
}
