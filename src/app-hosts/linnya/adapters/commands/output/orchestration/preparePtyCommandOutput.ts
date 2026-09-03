import {
  createBoundedPtyCommandOutputObservation,
} from '../../../../../../infra/adapters/command-runtime/pty';
import type {
  PtyCommandPreparedOutput,
  PtyCommandPreparedOutputInput,
  PtyCommandPreparedOutputSink,
} from '../definitions/ptyCommandOutputSession';
import { createPtyCommandOutputSession } from './createPtyCommandOutputSession';

/**
 * prepare 阶段不打开文件或 parser；只建立 owner 会立即消费的有界 observation。
 * 真正 output session 在 start/open 后创建一次，避免审批或 reservation 失败留下 artifact。
 */
export function preparePtyCommandOutput(
  input: PtyCommandPreparedOutputInput,
): PtyCommandPreparedOutput {
  const observation = createBoundedPtyCommandOutputObservation(input.observationLimits);
  let opened = false;
  return Object.freeze({
    observation,
    async open() {
      if (opened) throw new Error('PTY prepared output can only open once');
      opened = true;
      const session = await createPtyCommandOutputSession({
        owner: input.owner,
        artifactPort: input.artifactPort,
        text: {
          projection: input.projection,
          observation,
          openWriter: input.openWriter,
          ...(input.textLimits ? { limits: input.textLimits } : {}),
        },
        ...(input.retentionMs ? { retentionMs: input.retentionMs } : {}),
      });
      const sink: PtyCommandPreparedOutputSink = {
        acceptStarted: event => session.acceptStarted(event).status === 'accepted',
        acceptOutput: event => session.acceptOutput(event).status === 'accepted',
        acceptResize: size => session.acceptResize(size),
        settleRunnerTerminal: settlement => session.settleRunnerTerminal(settlement),
        settleRuntimeLoss: settlement => session.settleRuntimeLoss(settlement),
        settleBeforeSourceStart: settlement => session.settleBeforeSourceStart(settlement),
        settleBeforeSourceStartTermination: settlement => (
          session.settleBeforeSourceStartTermination(settlement)
        ),
      };
      return Object.freeze(sink);
    },
  });
}
