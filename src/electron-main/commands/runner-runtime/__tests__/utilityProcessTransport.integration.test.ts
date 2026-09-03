import { describe, expect, it } from 'vitest';

import { parseCommandRunnerRequest } from '@app/schemas/commands';
import type { CommandRunnerProcessHandlers } from '../../../../domains/commands';
import { parseCommandRunnerUtilityGeneration } from '../../../../infra/adapters/command-runtime/runner/definitions/commandRunnerUtilityTransport';
import type { CommandRunnerUtilityProcessLike } from '../functions/createUtilityProcessTransport';
import { createUtilityProcessTransport } from '../functions/createUtilityProcessTransport';

const GENERATION = parseCommandRunnerUtilityGeneration(
  '018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2a',
);

function createStopRequest() {
  return parseCommandRunnerRequest({
    protocol_version: 1,
    kind: 'command_runner_stop',
    identity: {
      conversation_id: 'conversation-a',
      agent_run_id: 'agent-run-a',
      origin_tool_call_id: 'tool-call-a',
      command_execution_id: 'command_execution_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2b',
      owner_generation_id: 'command_owner_018f47a8-7f3c-4cc7-8b8c-aea6ce8f4d2c',
      created_at_ms: 1_785_499_200_000,
    },
    cause: 'owner_ended',
  });
}

class FakeUtilityProcess implements CommandRunnerUtilityProcessLike {
  readonly stderr = null;
  readonly posted: unknown[] = [];
  killCount = 0;
  private messageListener: ((message: unknown) => void) | undefined;
  private exitListener: ((exitCode: number) => void) | undefined;
  private errorListener: ((type: 'FatalError', location: string, report: string) => void) | undefined;

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  kill(): boolean {
    this.killCount += 1;
    return true;
  }

  onMessage(listener: (message: unknown) => void): void {
    this.messageListener = listener;
  }

  onceExit(listener: (exitCode: number) => void): void {
    this.exitListener = listener;
  }

  onceError(
    listener: (type: 'FatalError', location: string, report: string) => void,
  ): void {
    this.errorListener = listener;
  }

  emitMessage(message: unknown): void {
    this.messageListener?.(message);
  }

  emitExit(exitCode: number): void {
    this.exitListener?.(exitCode);
  }

  emitError(): void {
    this.errorListener?.('FatalError', 'fixture.ts:1', 'bounded fixture report');
  }
}

function createHandlers(events: string[], messages: unknown[], errors: unknown[]): CommandRunnerProcessHandlers {
  return {
    onMessage(message) {
      messages.push(message);
    },
    onDiagnostic() {
      events.push('diagnostic');
    },
    onDisconnect() {
      events.push('disconnect');
    },
    onError(error) {
      errors.push(error);
      events.push('error');
    },
    onClose() {
      events.push('close');
    },
  };
}

describe('Electron utility process transport adapter', () => {
  it('ready ACK 形成控制屏障，业务请求在 ready 前不发送', async () => {
    const child = new FakeUtilityProcess();
    const events: string[] = [];
    const messages: unknown[] = [];
    const errors: unknown[] = [];
    const control = createUtilityProcessTransport({
      child,
      generation: GENERATION,
      handlers: createHandlers(events, messages, errors),
    });

    const sending = control.send(createStopRequest());
    expect(child.posted).toEqual([]);

    child.emitMessage({
      kind: 'command_runner_utility_message',
      generation: GENERATION,
      transport_message_id: 0,
      payload: { kind: 'command_runner_ready' },
    });
    await Promise.resolve();

    expect(child.posted).toHaveLength(2);
    expect(child.posted[0]).toMatchObject({
      kind: 'command_runner_utility_ack',
      transport_message_id: 0,
    });
    expect(child.posted[1]).toMatchObject({
      kind: 'command_runner_utility_message',
      transport_message_id: 0,
      payload: { kind: 'command_runner_request' },
    });

    child.emitMessage({
      kind: 'command_runner_utility_ack',
      generation: GENERATION,
      transport_message_id: 0,
    });
    await sending;
    expect(events).toEqual([]);
    expect(messages).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('显式 owner-end 同样等待 ready，并在 ACK 后保持 transport 活跃', async () => {
    const child = new FakeUtilityProcess();
    const events: string[] = [];
    const errors: unknown[] = [];
    const control = createUtilityProcessTransport({
      child,
      generation: GENERATION,
      handlers: createHandlers(events, [], errors),
    });

    control.disconnect();
    expect(child.posted).toEqual([]);
    child.emitMessage({
      kind: 'command_runner_utility_message',
      generation: GENERATION,
      transport_message_id: 0,
      payload: { kind: 'command_runner_ready' },
    });
    await Promise.resolve();

    expect(child.posted[1]).toMatchObject({
      kind: 'command_runner_utility_message',
      payload: { kind: 'command_runner_owner_end' },
    });
    child.emitMessage({
      kind: 'command_runner_utility_ack',
      generation: GENERATION,
      transport_message_id: 0,
    });
    await Promise.resolve();
    expect(events).toEqual([]);
    expect(errors).toEqual([]);
    expect(child.killCount).toBe(0);
  });

  it('utility exit 按 disconnect 后 close 投影，并拒绝 ready 前 pending', async () => {
    const child = new FakeUtilityProcess();
    const events: string[] = [];
    const errors: unknown[] = [];
    const control = createUtilityProcessTransport({
      child,
      generation: GENERATION,
      handlers: createHandlers(events, [], errors),
    });
    const sending = control.send(createStopRequest());

    child.emitExit(42);

    await expect(sending).rejects.toThrow('exited: 42');
    expect(events).toEqual(['disconnect', 'close']);
    expect(errors).toEqual([]);
  });

  it('协议损坏只发布一次 fatal error 并终止 utility', () => {
    const child = new FakeUtilityProcess();
    const events: string[] = [];
    const errors: unknown[] = [];
    createUtilityProcessTransport({
      child,
      generation: GENERATION,
      handlers: createHandlers(events, [], errors),
    });

    child.emitMessage({ kind: 'invalid_envelope' });
    child.emitMessage({ kind: 'another_invalid_envelope' });

    expect(events).toEqual(['error']);
    expect(errors).toHaveLength(1);
    expect(child.killCount).toBe(1);
  });

  it('Electron fatal error 进入同一个失败出口，不依赖 utility stderr', () => {
    const child = new FakeUtilityProcess();
    const events: string[] = [];
    const errors: unknown[] = [];
    createUtilityProcessTransport({
      child,
      generation: GENERATION,
      handlers: createHandlers(events, [], errors),
    });

    child.emitError();

    expect(events).toEqual(['error']);
    expect(errors).toHaveLength(1);
    expect(child.killCount).toBe(0);
  });
});
