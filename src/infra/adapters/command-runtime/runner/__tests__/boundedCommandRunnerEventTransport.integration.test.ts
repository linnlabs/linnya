import {
  parseCommandRunnerEvent,
  type CommandRunnerEventV1,
} from '@app/schemas/commands';
import { describe, expect, it } from 'vitest';

import { createBoundedCommandRunnerEventTransport } from '../functions/createBoundedCommandRunnerEventTransport';

const identity = {
  conversation_id: 'conversation_runner_transport',
  agent_run_id: 'agent_run_runner_transport',
  origin_tool_call_id: 'tool_call_runner_transport',
  command_execution_id: 'command_execution_00000000-0000-4000-8000-000000000001',
  owner_generation_id: 'command_owner_00000000-0000-4000-8000-000000000002',
  created_at_ms: 1,
} as const;

function createOutput(
  channel: 'stdout' | 'stderr',
  sequence: number,
  bytes: Uint8Array,
): Extract<CommandRunnerEventV1, { readonly kind: 'command_runner_output' }> {
  const event = parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_output',
    identity,
    channel,
    sequence,
    bytes,
  });
  if (event.kind !== 'command_runner_output') {
    throw new Error('test output fixture produced a control event');
  }
  return event;
}

function createStarted(): Exclude<
  CommandRunnerEventV1,
  { readonly kind: 'command_runner_output' | 'command_runner_pty_output' }
> {
  const event = parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_started',
    identity,
    started_at_ms: 2,
  });
  if (event.kind === 'command_runner_output' || event.kind === 'command_runner_pty_output') {
    throw new Error('test control fixture produced an output event');
  }
  return event;
}

function createPtyOutput(
  sequence: number,
  bytes: Uint8Array,
): Extract<CommandRunnerEventV1, { readonly kind: 'command_runner_pty_output' }> {
  const event = parseCommandRunnerEvent({
    protocol_version: 1,
    kind: 'command_runner_pty_output',
    identity,
    channel: 'terminal',
    sequence,
    bytes,
  });
  if (event.kind !== 'command_runner_pty_output') {
    throw new Error('test PTY output fixture produced another event kind');
  }
  return event;
}

function deferred(): {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
} {
  let resolvePromise = (): void => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>(resolve => setImmediate(resolve));
  }
  throw new Error('condition was not observed before the integration-test deadline');
}

describe('bounded command runner event transport', () => {
  it('把正在发送的 output 计入双预算，并在排空后按序发送 control', async () => {
    const firstSend = deferred();
    const sent: CommandRunnerEventV1[] = [];
    let sendCount = 0;
    const transport = createBoundedCommandRunnerEventTransport({
      limits: { maxPendingEvents: 2, maxPendingBytes: 4 },
      send: async (event) => {
        sent.push(event);
        sendCount += 1;
        if (sendCount === 1) await firstSend.promise;
      },
    });

    expect(transport.offerOutput(createOutput('stdout', 0, Uint8Array.of(1, 2))))
      .toEqual({ status: 'accepted' });
    await waitFor(() => sendCount === 1);
    expect(transport.offerOutput(createOutput('stderr', 0, Uint8Array.of(3, 4))))
      .toEqual({ status: 'accepted' });
    expect(transport.offerOutput(createOutput('stdout', 1, Uint8Array.of(5))))
      .toEqual({ status: 'overloaded' });

    const controlSent = transport.sendControl(createStarted());
    expect(sent.map(event => event.kind)).toEqual(['command_runner_output']);
    firstSend.resolve();
    await controlSent;

    expect(sent.map(event => event.kind)).toEqual([
      'command_runner_output',
      'command_runner_output',
      'command_runner_started',
    ]);
    expect(transport.offerOutput(createOutput('stdout', 1, Uint8Array.of(5, 6, 7, 8))))
      .toEqual({ status: 'accepted' });
    await transport.sendControl(createStarted());
  });

  it('在准入时复制小 view，调用方后续修改和巨大 backing buffer 都不会泄漏', async () => {
    const backing = new Uint8Array(1024 * 1024);
    backing.set([11, 12, 13], 128);
    const view = backing.subarray(128, 131);
    const sent: CommandRunnerEventV1[] = [];
    const transport = createBoundedCommandRunnerEventTransport({
      send: async (event) => {
        sent.push(event);
      },
    });

    expect(transport.offerOutput(createOutput('stdout', 0, view)))
      .toEqual({ status: 'accepted' });
    view.fill(99);
    await transport.sendControl(createStarted());

    const output = sent[0];
    expect(output?.kind).toBe('command_runner_output');
    if (output?.kind !== 'command_runner_output') {
      throw new Error('first sent event was not output');
    }
    expect([...output.bytes]).toEqual([11, 12, 13]);
    expect(output.bytes.buffer.byteLength).toBe(3);
  });

  it('首次底层发送失败后清空待发送队列并永久返回 unavailable', async () => {
    const sendFailure = new Error('test IPC channel closed');
    let sendCount = 0;
    const transport = createBoundedCommandRunnerEventTransport({
      send: async () => {
        sendCount += 1;
        throw sendFailure;
      },
    });

    expect(transport.offerOutput(createOutput('stdout', 0, Uint8Array.of(1))))
      .toEqual({ status: 'accepted' });
    expect(transport.offerOutput(createOutput('stderr', 0, Uint8Array.of(2))))
      .toEqual({ status: 'accepted' });
    await expect(transport.sendControl(createStarted())).rejects.toBe(sendFailure);
    expect(sendCount).toBe(1);
    expect(transport.offerOutput(createOutput('stdout', 1, Uint8Array.of(3))))
      .toEqual({ status: 'unavailable' });
    await expect(transport.sendControl(createStarted())).rejects.toBe(sendFailure);
    expect(sendCount).toBe(1);
  });

  it('一次 output 超限不是永久熔断，容量释放后另一条流仍能继续', async () => {
    const firstSend = deferred();
    let sendCount = 0;
    const transport = createBoundedCommandRunnerEventTransport({
      limits: { maxPendingEvents: 1, maxPendingBytes: 1 },
      send: async () => {
        sendCount += 1;
        if (sendCount === 1) await firstSend.promise;
      },
    });

    expect(transport.offerOutput(createOutput('stdout', 0, Uint8Array.of(1))))
      .toEqual({ status: 'accepted' });
    await waitFor(() => sendCount === 1);
    expect(transport.offerOutput(createOutput('stdout', 1, Uint8Array.of(2))))
      .toEqual({ status: 'overloaded' });
    firstSend.resolve();
    await transport.sendControl(createStarted());

    expect(transport.offerOutput(createOutput('stderr', 0, Uint8Array.of(3))))
      .toEqual({ status: 'accepted' });
    await transport.sendControl(createStarted());
    expect(sendCount).toBe(4);
  });

  it('多个并发 control 按调用顺序串行发送，后一个不能越过前一个', async () => {
    const firstControlSend = deferred();
    const sent: CommandRunnerEventV1[] = [];
    let activeSends = 0;
    let maxActiveSends = 0;
    const transport = createBoundedCommandRunnerEventTransport({
      send: async (event) => {
        activeSends += 1;
        maxActiveSends = Math.max(maxActiveSends, activeSends);
        sent.push(event);
        if (sent.length === 1) await firstControlSend.promise;
        activeSends -= 1;
      },
    });

    const first = transport.sendControl(createStarted());
    const second = transport.sendControl(createStarted());
    await waitFor(() => sent.length === 1);
    expect(maxActiveSends).toBe(1);

    firstControlSend.resolve();
    await Promise.all([first, second]);
    expect(sent.map(event => event.kind)).toEqual([
      'command_runner_started',
      'command_runner_started',
    ]);
    expect(maxActiveSends).toBe(1);
  });

  it('PTY terminal 帧与 pipe 输出共用有界队列，不能误走 control 通道', async () => {
    const firstSend = deferred();
    const sent: CommandRunnerEventV1[] = [];
    const transport = createBoundedCommandRunnerEventTransport({
      limits: { maxPendingEvents: 1, maxPendingBytes: 2 },
      send: async (event) => {
        sent.push(event);
        if (sent.length === 1) await firstSend.promise;
      },
    });

    expect(transport.offerOutput(createPtyOutput(0, Uint8Array.of(1, 2))))
      .toEqual({ status: 'accepted' });
    await waitFor(() => sent.length === 1);
    expect(transport.offerOutput(createPtyOutput(1, Uint8Array.of(3))))
      .toEqual({ status: 'overloaded' });

    firstSend.resolve();
    await transport.sendControl(createStarted());
    expect(sent.map(event => event.kind)).toEqual([
      'command_runner_pty_output',
      'command_runner_started',
    ]);
  });
});
