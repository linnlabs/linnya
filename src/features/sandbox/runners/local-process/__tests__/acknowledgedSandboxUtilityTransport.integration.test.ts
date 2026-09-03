import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  SANDBOX_UTILITY_MAX_PENDING_ACKNOWLEDGEMENTS,
  parseSandboxUtilityChildPayload,
  parseSandboxUtilityGeneration,
  parseSandboxUtilityHostPayload,
} from '../definitions/sandboxUtilityTransport.js';
import { createAcknowledgedSandboxUtilityTransport } from '../functions/createAcknowledgedSandboxUtilityTransport.js';

const GENERATION = '12345678-1234-1234-1234-123456789abc';
const RUN_TOKEN = '0'.repeat(32);

describe('acknowledged sandbox utility transport', () => {
  it('只在同步接纳消息后回复 ACK，并独立结算发送方', async () => {
    const posted: unknown[] = [];
    const accepted: string[] = [];
    const failures: Error[] = [];
    const transport = createTransport({ posted, accepted, failures });

    const sent = transport.send('start');
    expect(posted).toEqual([messageEnvelope(0, 'start')]);

    transport.receive(ackEnvelope(0));
    await expect(sent).resolves.toBeUndefined();

    transport.receive(messageEnvelope(0, 'ready'));
    expect(accepted).toEqual(['ready']);
    expect(posted[posted.length - 1]).toEqual(ackEnvelope(0));
    expect(failures).toEqual([]);
  });

  it('同步接纳失败时不回复 ACK，并且只发布一次 transport failure', async () => {
    const posted: unknown[] = [];
    const failures: Error[] = [];
    const transport = createAcknowledgedSandboxUtilityTransport<string, string>({
      generation: GENERATION,
      postMessage: envelope => {
        posted.push(envelope);
      },
      parseIncomingPayload: readString,
      acceptIncomingPayload: () => {
        throw new Error('owner rejected payload');
      },
      onFailure: error => {
        failures.push(error);
      },
      acknowledgementDeadlineMs: 100,
    });

    transport.receive(messageEnvelope(0, 'ready'));
    transport.receive(messageEnvelope(0, 'ready'));

    expect(posted).toEqual([]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toBe('owner rejected payload');
    await expect(transport.send('start')).rejects.toThrow('owner rejected payload');
  });

  it('在途 ACK 达到固定容量时关闭 transport 并统一拒绝等待者', async () => {
    const posted: unknown[] = [];
    const accepted: string[] = [];
    const failures: Error[] = [];
    const transport = createTransport({ posted, accepted, failures });
    const pending = Array.from(
      { length: SANDBOX_UTILITY_MAX_PENDING_ACKNOWLEDGEMENTS },
      (_, index) => transport.send(`start-${index}`)
    );
    const settlement = Promise.allSettled(pending);

    await expect(transport.send('overflow')).rejects.toThrow(
      'sandbox utility pending acknowledgement capacity exceeded'
    );
    const settled = await settlement;

    expect(posted).toHaveLength(SANDBOX_UTILITY_MAX_PENDING_ACKNOWLEDGEMENTS);
    expect(settled.every(result => result.status === 'rejected')).toBe(true);
    expect(failures).toHaveLength(1);
  });

  it('乱序 ACK、超时和显式关闭都让 transport 后续稳定失败', async () => {
    vi.useFakeTimers();
    try {
      const posted: unknown[] = [];
      const accepted: string[] = [];
      const failures: Error[] = [];
      const outOfOrder = createTransport({ posted, accepted, failures });
      const first = outOfOrder.send('first');
      const firstSettlement = first.catch(toError);
      outOfOrder.receive(ackEnvelope(1));
      await expect(firstSettlement).resolves.toMatchObject({
        message: 'unexpected sandbox utility acknowledgement: 1',
      });
      expect(failures).toHaveLength(1);

      const timeoutFailures: Error[] = [];
      const timedOut = createTransport({
        posted: [],
        accepted: [],
        failures: timeoutFailures,
        acknowledgementDeadlineMs: 10,
      });
      const timedOutSend = timedOut.send('start');
      const timedOutSettlement = timedOutSend.catch(toError);
      await vi.advanceTimersByTimeAsync(10);
      await expect(timedOutSettlement).resolves.toMatchObject({
        message: 'sandbox utility acknowledgement timed out: 0',
      });
      expect(timeoutFailures).toHaveLength(1);

      const closed = createTransport({ posted: [], accepted: [], failures: [] });
      const waiting = closed.send('start');
      const waitingSettlement = waiting.catch(toError);
      closed.close(new Error('owner ended'));
      await expect(waitingSettlement).resolves.toMatchObject({ message: 'owner ended' });
      await expect(closed.send('again')).rejects.toThrow('owner ended');
    } finally {
      vi.useRealTimers();
    }
  });

  it('忽略旧 Utility 的合法消息，但拒绝当前代次的乱序、malformed 和未知 ACK', async () => {
    const posted: unknown[] = [];
    const accepted: string[] = [];
    const failures: Error[] = [];
    const transport = createTransport({ posted, accepted, failures });

    transport.receive({
      ...messageEnvelope(0, 'stale'),
      generation: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    expect(accepted).toEqual([]);
    expect(failures).toEqual([]);

    transport.receive(messageEnvelope(1, 'out-of-order'));
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toContain('message sequence mismatch');

    const malformedFailures: Error[] = [];
    const malformed = createTransport({ posted: [], accepted: [], failures: malformedFailures });
    malformed.receive({ kind: 'sandbox_utility_message', generation: GENERATION, messageId: 0 });
    expect(malformedFailures).toHaveLength(1);

    const unknownAckFailures: Error[] = [];
    const unknownAck = createTransport({ posted: [], accepted: [], failures: unknownAckFailures });
    unknownAck.receive(ackEnvelope(0));
    expect(unknownAckFailures).toHaveLength(1);
    expect(unknownAckFailures[0]?.message).toContain('unexpected sandbox utility acknowledgement');
  });

  it('postMessage 同步抛错时拒绝发送并只发布一次失败', async () => {
    const failures: Error[] = [];
    const transport = createAcknowledgedSandboxUtilityTransport<string, string>({
      generation: GENERATION,
      postMessage: () => {
        throw new Error('port closed');
      },
      parseIncomingPayload: readString,
      acceptIncomingPayload: () => undefined,
      onFailure: error => {
        failures.push(error);
      },
    });

    await expect(transport.send('start')).rejects.toThrow('port closed');
    await expect(transport.send('again')).rejects.toThrow('port closed');
    expect(failures).toHaveLength(1);
  });

  it('generation、terminal control snapshot 与 root exit 使用严格合同', () => {
    expect(parseSandboxUtilityGeneration(GENERATION)).toBe(GENERATION);
    expect(() => parseSandboxUtilityGeneration('zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz')).toThrow(
      'generation is invalid'
    );

    const terminal = {
      kind: 'sandbox_terminal',
      runToken: RUN_TOKEN,
      cause: 'natural',
      rootExit: { exitCode: 0, signal: null },
      control: {
        acceptedFrames: ['ready', 'started', 'result_committed'],
        evaluatorPid: 2468,
        windowsCrLfPreambleObserved: false,
        completed: true,
      },
      stderrBytes: 0,
      stderrTail: '',
      settlementFailures: [],
    };
    expect(parseSandboxUtilityChildPayload(terminal)).toMatchObject({ kind: 'sandbox_terminal' });
    expect(() =>
      parseSandboxUtilityChildPayload({
        ...terminal,
        control: { ...terminal.control, acceptedFrames: ['started'] },
      })
    ).toThrow('snapshot state is inconsistent');
    expect(() =>
      parseSandboxUtilityChildPayload({
        ...terminal,
        rootExit: { exitCode: 0, signal: 'SIGTERM' },
      })
    ).toThrow('root exit fields are invalid');
    expect(() =>
      parseSandboxUtilityChildPayload({
        ...terminal,
        rootExit: { exitCode: -1, signal: null },
      })
    ).toThrow('root exit fields are invalid');
  });

  it('start payload 只接受绝对 run/evaluator 路径和统一 heap 范围', () => {
    const payload = {
      kind: 'sandbox_start',
      runToken: RUN_TOKEN,
      runDirectory: path.resolve('sandbox-run'),
      timeoutMs: 1_000,
      idleTimeoutMs: 1_000,
      maximumHeapMb: 128,
      evaluator: {
        executablePath: path.resolve('sandbox-evaluator'),
        entryPath: path.resolve('sandboxEvaluatorProcess.cjs'),
        environment: {},
      },
    };
    expect(parseSandboxUtilityHostPayload(payload)).toMatchObject({ kind: 'sandbox_start' });
    expect(() =>
      parseSandboxUtilityHostPayload({
        ...payload,
        runDirectory: 'relative/run',
      })
    ).toThrow('runDirectory must be absolute');
    expect(() =>
      parseSandboxUtilityHostPayload({
        ...payload,
        evaluator: { ...payload.evaluator, executablePath: 'relative/evaluator' },
      })
    ).toThrow('executablePath must be absolute');
    expect(() => parseSandboxUtilityHostPayload({ ...payload, maximumHeapMb: 8 })).toThrow(
      'heap limit is outside the supported range'
    );
  });
});

function createTransport(input: {
  readonly posted: unknown[];
  readonly accepted: string[];
  readonly failures: Error[];
  readonly acknowledgementDeadlineMs?: number;
}) {
  return createAcknowledgedSandboxUtilityTransport<string, string>({
    generation: GENERATION,
    postMessage: envelope => {
      input.posted.push(envelope);
    },
    parseIncomingPayload: readString,
    acceptIncomingPayload: payload => {
      input.accepted.push(payload);
      return undefined;
    },
    onFailure: error => {
      input.failures.push(error);
    },
    ...(input.acknowledgementDeadlineMs === undefined
      ? {}
      : { acknowledgementDeadlineMs: input.acknowledgementDeadlineMs }),
  });
}

function readString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('payload must be a string');
  return value;
}

function messageEnvelope(
  messageId: number,
  payload: string
): {
  readonly kind: 'sandbox_utility_message';
  readonly generation: string;
  readonly messageId: number;
  readonly payload: string;
} {
  return {
    kind: 'sandbox_utility_message',
    generation: GENERATION,
    messageId,
    payload,
  };
}

function ackEnvelope(messageId: number): {
  readonly kind: 'sandbox_utility_ack';
  readonly generation: string;
  readonly messageId: number;
} {
  return {
    kind: 'sandbox_utility_ack',
    generation: GENERATION,
    messageId,
  };
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
