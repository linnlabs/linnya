import { describe, expect, it } from 'vitest';

import type {
  CommandRunnerUtilityChildPayload,
  CommandRunnerUtilityGeneration,
  CommandRunnerUtilityHostPayload,
} from '../definitions/commandRunnerUtilityTransport';
import {
  parseCommandRunnerUtilityChildPayload,
  parseCommandRunnerUtilityGeneration,
  parseCommandRunnerUtilityHostPayload,
} from '../definitions/commandRunnerUtilityTransport';
import type { AcknowledgedCommandRunnerUtilityTransport } from '../functions/createAcknowledgedCommandRunnerUtilityTransport';
import { createAcknowledgedCommandRunnerUtilityTransport } from '../functions/createAcknowledgedCommandRunnerUtilityTransport';

const GENERATION = parseCommandRunnerUtilityGeneration(
  '018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a',
);

function deliver<TPayload>(
  target: AcknowledgedCommandRunnerUtilityTransport<TPayload> | undefined,
  envelope: unknown,
): void {
  if (!target) throw new Error('linked utility transport is unavailable');
  target.receive(envelope);
}

describe('acknowledged command runner utility transport', () => {
  it('只在接收方完成同步分派后确认，并保持双向顺序', async () => {
    const acceptedByChild: CommandRunnerUtilityHostPayload[] = [];
    const acceptedByHost: CommandRunnerUtilityChildPayload[] = [];
    let host: AcknowledgedCommandRunnerUtilityTransport<
      CommandRunnerUtilityHostPayload
    > | undefined;
    let child: AcknowledgedCommandRunnerUtilityTransport<
      CommandRunnerUtilityChildPayload
    > | undefined;

    child = createAcknowledgedCommandRunnerUtilityTransport({
      generation: GENERATION,
      postMessage: envelope => deliver(host, envelope),
      parseIncomingPayload: parseCommandRunnerUtilityHostPayload,
      acceptIncomingPayload: payload => acceptedByChild.push(payload),
      onFailure: error => { throw error; },
    });
    host = createAcknowledgedCommandRunnerUtilityTransport({
      generation: GENERATION,
      postMessage: envelope => deliver(child, envelope),
      parseIncomingPayload: parseCommandRunnerUtilityChildPayload,
      acceptIncomingPayload: payload => acceptedByHost.push(payload),
      onFailure: error => { throw error; },
    });

    await child.send({ kind: 'command_runner_ready' });
    expect(acceptedByHost).toEqual([{ kind: 'command_runner_ready' }]);

    const request = { kind: 'command_runner_request', request: { command: 'pwd' } } as const;
    await host.send(request);
    await child.send({ kind: 'command_runner_event', event: { sequence: 0 } });
    await child.send({ kind: 'command_runner_event', event: { sequence: 1 } });

    expect(acceptedByChild).toEqual([request]);
    expect(acceptedByHost).toEqual([
      { kind: 'command_runner_ready' },
      { kind: 'command_runner_event', event: { sequence: 0 } },
      { kind: 'command_runner_event', event: { sequence: 1 } },
    ]);
  });

  it('忽略旧 generation，不让迟到 callback 破坏当前 owner', () => {
    const failures: Error[] = [];
    const accepted: CommandRunnerUtilityChildPayload[] = [];
    const transport = createAcknowledgedCommandRunnerUtilityTransport({
      generation: GENERATION,
      postMessage: () => undefined,
      parseIncomingPayload: parseCommandRunnerUtilityChildPayload,
      acceptIncomingPayload: payload => accepted.push(payload),
      onFailure: error => failures.push(error),
    });

    transport.receive({
      kind: 'command_runner_utility_message',
      generation: '018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
      transport_message_id: 0,
      payload: { kind: 'command_runner_ready' },
    });

    expect(accepted).toEqual([]);
    expect(failures).toEqual([]);
  });

  it('序列损坏后统一关闭 transport，后续发送不再进入 postMessage', async () => {
    const failures: Error[] = [];
    let postCount = 0;
    const transport = createAcknowledgedCommandRunnerUtilityTransport({
      generation: GENERATION,
      postMessage: () => { postCount += 1; },
      parseIncomingPayload: parseCommandRunnerUtilityChildPayload,
      acceptIncomingPayload: () => undefined,
      onFailure: error => failures.push(error),
    });

    transport.receive({
      kind: 'command_runner_utility_message',
      generation: GENERATION,
      transport_message_id: 1,
      payload: { kind: 'command_runner_ready' },
    });

    await expect(transport.send({ kind: 'command_runner_owner_end' }))
      .rejects.toThrow('sequence mismatch');
    expect(failures).toHaveLength(1);
    expect(postCount).toBe(0);
  });

  it('ACK 缺失时拒绝本轮和全部 pending，且只发布一次失败', async () => {
    const failures: Error[] = [];
    const transport = createAcknowledgedCommandRunnerUtilityTransport({
      generation: GENERATION,
      postMessage: () => undefined,
      parseIncomingPayload: parseCommandRunnerUtilityHostPayload,
      acceptIncomingPayload: () => undefined,
      onFailure: error => failures.push(error),
      acknowledgementDeadlineMs: 10,
    });

    const first = transport.send({ kind: 'command_runner_ready' });
    const second = transport.send({
      kind: 'command_runner_event',
      event: { bytes: Uint8Array.from([0x00, 0xff]) },
    });

    await expect(first).rejects.toThrow('acknowledgement timed out');
    await expect(second).rejects.toThrow('acknowledgement timed out');
    await expect(transport.send({ kind: 'command_runner_ready' }))
      .rejects.toThrow('acknowledgement timed out');
    expect(failures).toHaveLength(1);
  });

  it('正常 close 只拒绝 pending，不伪造协议失败', async () => {
    const failures: Error[] = [];
    const transport = createAcknowledgedCommandRunnerUtilityTransport({
      generation: GENERATION,
      postMessage: () => undefined,
      parseIncomingPayload: parseCommandRunnerUtilityHostPayload,
      acceptIncomingPayload: () => undefined,
      onFailure: error => failures.push(error),
    });
    const pending = transport.send({ kind: 'command_runner_ready' });

    transport.close(new Error('utility exited'));

    await expect(pending).rejects.toThrow('utility exited');
    expect(failures).toEqual([]);
  });

  it('generation 必须是稳定 UUID', () => {
    expect(() => parseCommandRunnerUtilityGeneration('runner-1')).toThrow();
    expect(GENERATION).toSatisfy((value: CommandRunnerUtilityGeneration) => (
      value === '018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a'
    ));
  });
});
