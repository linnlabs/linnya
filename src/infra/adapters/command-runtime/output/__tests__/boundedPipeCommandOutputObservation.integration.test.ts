import { ProcessOutputCursorSchema } from '@app/schemas/commands';
import { describe, expect, it } from 'vitest';

import { createBoundedPipeCommandOutputObservation } from '../functions/createBoundedPipeCommandOutputObservation';

const EMPTY_LINES = {
  stdout: { text: '', omittedCharacters: 0 },
  stderr: { text: '', omittedCharacters: 0 },
} as const;

function cursor(value: number) {
  return ProcessOutputCursorSchema.parse(value);
}

describe('bounded pipe command output observation', () => {
  it('同一 cursor 可被多个读取者重试，stdout/stderr 不互相消费或合流', () => {
    const observation = createBoundedPipeCommandOutputObservation({
      maxEvents: 20,
      maxCharacters: 100,
    });
    observation.accept({
      channel: 'stdout',
      stableText: 'out-1\n',
      currentLogicalLines: EMPTY_LINES,
    });
    observation.accept({
      channel: 'stderr',
      stableText: 'err-1\n',
      currentLogicalLines: EMPTY_LINES,
    });

    const first = observation.read(cursor(0));
    const retry = observation.read(cursor(0));
    expect(retry).toEqual(first);
    expect(first).toMatchObject({
      status: 'observed',
      observation: {
        coverage: 'complete',
        stdout: 'out-1\n',
        stderr: 'err-1\n',
        outputPhase: 'open',
      },
    });
  });

  it('窗口落后时明确报告省略，并保持 Unicode 边界和当前 CR 行', () => {
    const observation = createBoundedPipeCommandOutputObservation({
      maxEvents: 3,
      maxCharacters: 6,
    });
    observation.accept({
      channel: 'stdout',
      stableText: 'A🙂B',
      currentLogicalLines: {
        ...EMPTY_LINES,
        stdout: { text: '10%', omittedCharacters: 0 },
      },
    });
    observation.accept({
      channel: 'stderr',
      stableText: '错误',
      currentLogicalLines: {
        ...EMPTY_LINES,
        stdout: { text: '20%', omittedCharacters: 0 },
      },
    });

    expect(observation.read(cursor(0))).toMatchObject({
      status: 'observed',
      observation: {
        coverage: 'omitted',
        availableAfterCursor: 1,
        stdout: '',
        stderr: '错误',
        currentLogicalLines: {
          stdout: { text: '20%' },
        },
      },
    });
  });

  it('wait 被新观察、关闭或自身等待到期唤醒，等待到期不推进 cursor', async () => {
    const observation = createBoundedPipeCommandOutputObservation({
      maxEvents: 20,
      maxCharacters: 100,
    });
    const changed = observation.waitForChange({
      afterCursor: cursor(0),
      waitTimeoutMs: 100,
    });
    observation.accept({
      channel: 'stdout',
      stableText: '',
      currentLogicalLines: {
        ...EMPTY_LINES,
        stdout: { text: 'progress', omittedCharacters: 0 },
      },
    });
    await expect(changed).resolves.toMatchObject({
      status: 'observed',
      observation: {
        nextCursor: 1,
        currentLogicalLines: { stdout: { text: 'progress' } },
      },
    });

    const timedOut = await observation.waitForChange({
      afterCursor: cursor(1),
      waitTimeoutMs: 5,
    });
    expect(timedOut).toMatchObject({
      status: 'observed',
      observation: { nextCursor: 1, outputPhase: 'open' },
    });

    const closed = observation.waitForChange({
      afterCursor: cursor(1),
      waitTimeoutMs: 100,
    });
    observation.close({ trailingStableText: { stdout: 'done', stderr: '' } });
    await expect(closed).resolves.toMatchObject({
      status: 'observed',
      observation: { stdout: 'done', outputPhase: 'closed' },
    });
  });

  it('拒绝未来 cursor，并在投影故障后唤醒 waiter 且保留最后安全窗口', async () => {
    const observation = createBoundedPipeCommandOutputObservation({
      maxEvents: 20,
      maxCharacters: 100,
    });
    expect(observation.read(cursor(1))).toEqual({ status: 'invalid_cursor' });

    const waiting = observation.waitForChange({
      afterCursor: cursor(0),
      waitTimeoutMs: 100,
    });
    observation.markProjectionFailed();
    await expect(waiting).resolves.toMatchObject({
      status: 'observed',
      observation: { textProjection: 'failed', nextCursor: 1 },
    });
  });
});
