import { describe, expect, it } from 'vitest';

import {
  SANDBOX_CONTROL_FRAME_MAX_BYTES,
  SandboxControlProtocolError,
  type SandboxControlFrameKind,
} from '../definitions/sandboxControlProtocol.js';
import {
  createSandboxControlFrameStateMachine,
  serializeSandboxControlFrame,
} from '../functions/createSandboxControlFrameStateMachine.js';

const RUN_TOKEN = '0'.repeat(32);
const MISMATCHED_RUN_TOKEN = '1'.repeat(32);
const PID = 2468;

function frame(
  kind: SandboxControlFrameKind,
  overrides: Readonly<Record<string, unknown>> = {}
): string {
  return `${JSON.stringify({
    protocol_version: 1,
    kind,
    run_token: RUN_TOKEN,
    pid: PID,
    ...overrides,
  })}\n`;
}

function bytes(value: string): Uint8Array {
  return Buffer.from(value, 'utf8');
}

describe('Sandbox control frame state machine', () => {
  it('跨任意 chunk 严格接收 ready -> started -> result_committed', () => {
    const machine = createSandboxControlFrameStateMachine({
      platform: 'darwin',
      runToken: RUN_TOKEN,
    });
    const wire = bytes(`${frame('ready')}${frame('started')}${frame('result_committed')}`);
    const accepted = [];
    for (let offset = 0; offset < wire.byteLength; offset += 7) {
      accepted.push(...machine.accept(wire.subarray(offset, offset + 7)));
    }

    expect(accepted.map(entry => entry.kind)).toEqual(['ready', 'started', 'result_committed']);
    expect(machine.finish()).toEqual({
      acceptedFrames: ['ready', 'started', 'result_committed'],
      evaluatorPid: PID,
      windowsCrLfPreambleObserved: false,
      completed: true,
    });
  });

  it('evaluator writer 使用同一严格合同序列化 frame 并包含最终换行', () => {
    const serialized = serializeSandboxControlFrame({
      protocol_version: 1,
      kind: 'ready',
      run_token: RUN_TOKEN,
      pid: PID,
    });
    expect(Buffer.from(serialized).toString('utf8')).toBe(frame('ready'));
    expect(() =>
      serializeSandboxControlFrame({
        protocol_version: 1,
        kind: 'ready',
        run_token: 'invalid',
        pid: PID,
      })
    ).toThrowError(expect.objectContaining({ code: 'control_frame_invalid' }));
  });

  it('Windows 只允许首个业务 frame 前出现一次精确 CRLF', () => {
    const machine = createSandboxControlFrameStateMachine({
      platform: 'win32',
      runToken: RUN_TOKEN,
    });
    machine.accept(bytes(`\r\n${frame('ready')}${frame('started')}${frame('result_committed')}`));
    expect(machine.finish().windowsCrLfPreambleObserved).toBe(true);

    const duplicate = createSandboxControlFrameStateMachine({
      platform: 'win32',
      runToken: RUN_TOKEN,
    });
    expect(() => duplicate.accept(bytes(`\r\n\r\n${frame('ready')}`))).toThrowError(
      expect.objectContaining({ code: 'control_frame_malformed_json' })
    );

    const macos = createSandboxControlFrameStateMachine({
      platform: 'darwin',
      runToken: RUN_TOKEN,
    });
    expect(() => macos.accept(bytes(`\r\n${frame('ready')}`))).toThrowError(
      expect.objectContaining({ code: 'control_frame_malformed_json' })
    );
  });

  it.each([
    ['乱序', `${frame('started')}`, 'control_frame_unexpected'],
    ['重复', `${frame('ready')}${frame('ready')}`, 'control_frame_unexpected'],
    [
      'token 不同',
      frame('ready', { run_token: MISMATCHED_RUN_TOKEN }),
      'control_frame_token_mismatch',
    ],
    [
      'PID 改变',
      `${frame('ready')}${frame('started', { pid: PID + 1 })}`,
      'control_frame_pid_mismatch',
    ],
    ['额外字段', frame('ready', { extra: true }), 'control_frame_invalid'],
  ])('拒绝%s控制序列', (_label, wire, code) => {
    const machine = createSandboxControlFrameStateMachine({
      platform: 'darwin',
      runToken: RUN_TOKEN,
    });
    expect(() => machine.accept(bytes(wire))).toThrowError(expect.objectContaining({ code }));
  });

  it('拒绝 partial、oversize、不完整序列和终态后数据', () => {
    const partial = createSandboxControlFrameStateMachine({
      platform: 'darwin',
      runToken: RUN_TOKEN,
    });
    partial.accept(bytes('{"protocol_version":1'));
    expect(() => partial.finish()).toThrowError(
      expect.objectContaining({ code: 'control_frame_partial' })
    );

    const oversized = createSandboxControlFrameStateMachine({
      platform: 'darwin',
      runToken: RUN_TOKEN,
    });
    expect(() =>
      oversized.accept(Buffer.alloc(SANDBOX_CONTROL_FRAME_MAX_BYTES, 0x78))
    ).toThrowError(expect.objectContaining({ code: 'control_frame_oversized' }));

    const incomplete = createSandboxControlFrameStateMachine({
      platform: 'darwin',
      runToken: RUN_TOKEN,
    });
    incomplete.accept(bytes(frame('ready')));
    expect(() => incomplete.finish()).toThrowError(
      expect.objectContaining({ code: 'control_sequence_incomplete' })
    );

    const terminal = createSandboxControlFrameStateMachine({
      platform: 'darwin',
      runToken: RUN_TOKEN,
    });
    terminal.accept(bytes(`${frame('ready')}${frame('started')}${frame('result_committed')}`));
    expect(() => terminal.accept(bytes('x'))).toThrowError(
      expect.objectContaining({ code: 'control_stream_after_terminal' })
    );

    const sameChunk = createSandboxControlFrameStateMachine({
      platform: 'darwin',
      runToken: RUN_TOKEN,
    });
    expect(() =>
      sameChunk.accept(bytes(`${frame('ready')}${frame('started')}${frame('result_committed')}x`))
    ).toThrowError(expect.objectContaining({ code: 'control_stream_after_terminal' }));
  });

  it('malformed frame 错误只保留 code/bytes，不泄漏正文或 hex', () => {
    const machine = createSandboxControlFrameStateMachine({
      platform: 'darwin',
      runToken: RUN_TOKEN,
    });
    const secret = 'SECRET_CONTROL_PAYLOAD';
    let error: unknown;
    try {
      machine.accept(bytes(`${secret}\n`));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(SandboxControlProtocolError);
    expect(error).toMatchObject({
      code: 'control_frame_malformed_json',
      byteLength: secret.length,
    });
    expect(String(error)).not.toContain(secret);
    expect(String(error)).not.toContain(Buffer.from(secret).toString('hex'));
    if (!(error instanceof Error)) throw new Error('预期控制状态机返回 Error');
    expect(() => machine.accept(bytes(frame('ready')))).toThrow(error);
  });
});
