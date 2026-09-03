import assert from 'node:assert/strict';

import type { CanonicalInferencePort } from '@linnlabs/linnkit/ports';
import { ShellAgentModelControlV1Schema } from '@app/schemas/commands';

import { parseCommandToolModelControlLine } from '../../../../../src/domains/commands';
import {
  answerEvents,
  requireToolMessageText,
  startInferenceEvent,
  toolCallEvents,
} from '../../harness/deterministicInferenceEvents';

export interface DeterministicInferencePort extends CanonicalInferencePort {
  assertComplete(): void;
}

/** 只替换不可控的外部模型，并直接实现生产 canonical inference 边界。 */
export function createDeterministicInferencePort(input: {
  readonly toolCallId: string;
  readonly command: string;
  readonly expectedStdout: string;
  readonly expectedStderr: string;
  readonly rejectedToolCalls: readonly {
    readonly toolCallId: string;
    readonly command: string;
    readonly cwd: string;
  }[];
  readonly afterRejectedCalls: () => Promise<void>;
}): DeterministicInferencePort {
  let callCount = 0;

  return {
    async *stream(request) {
      callCount += 1;
      yield startInferenceEvent(request);

      if (callCount === 1) {
        for (const [index, call] of input.rejectedToolCalls.entries()) {
          yield* toolCallEvents({
            index,
            id: call.toolCallId,
            name: 'shell',
            arguments: {
              command: call.command,
              cwd: call.cwd,
              initial_wait_ms: 5_000,
            },
          }).slice(0, -1);
        }
        yield { type: 'finish', reason: 'tool_use' };
        return;
      }

      if (callCount === 2) {
        for (const rejectedCall of input.rejectedToolCalls) {
          const observation = requireToolMessageText(request.messages, rejectedCall.toolCallId);
          const control = ShellAgentModelControlV1Schema.parse(
            parseCommandToolModelControlLine(observation),
          );
          assert.equal(control.status, 'rejected');
          if (control.status !== 'rejected') throw new Error('missing cwd must reject before launch');
          assert.equal(control.code, 'working_directory_unavailable');
        }
        await input.afterRejectedCalls();
        yield* toolCallEvents({
          id: input.toolCallId,
          name: 'shell',
          arguments: { command: input.command, initial_wait_ms: 5_000 },
        });
        return;
      }

      if (callCount === 3) {
        const observation = requireToolMessageText(request.messages, input.toolCallId);
        assert(observation.includes(input.expectedStdout));
        assert(observation.includes(input.expectedStderr));
        for (const forbidden of [
          'PC53_CLIPBOARD_SECRET',
          'PC53_TITLE_SECRET',
          'PC53_DCS_SECRET',
        ]) {
          assert(!observation.includes(forbidden), `model output leaked ${forbidden}`);
        }
        assert(!observation.includes('\u001b'), 'model output must not contain escape controls');
        yield* answerEvents('命令执行已验证。');
        return;
      }

      throw new Error(`unexpected deterministic model call: ${callCount}`);
    },

    assertComplete(): void {
      assert.equal(callCount, 3, 'graph must consume rejected cwd calls and the recovery command');
    },
  };
}
