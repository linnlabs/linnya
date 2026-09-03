import { TextDecoder } from 'node:util';

import {
  SANDBOX_CONTROL_FRAME_MAX_BYTES,
  SANDBOX_CONTROL_PROTOCOL_VERSION,
  SandboxControlProtocolError,
  type SandboxControlFrame,
  type SandboxControlFrameKind,
  type SandboxControlFrameStateMachine,
  type SandboxControlProtocolSnapshot,
} from '../definitions/sandboxControlProtocol.js';
import { parseSandboxRunToken } from '../definitions/sandboxMailboxProtocol.js';

type ExpectedFrameKind = SandboxControlFrameKind | 'complete';

export function serializeSandboxControlFrame(frame: SandboxControlFrame): Uint8Array {
  let parsed: SandboxControlFrame;
  try {
    parsed = parseControlFrame(frame, 0);
    parseSandboxRunToken(parsed.run_token);
  } catch {
    throw new SandboxControlProtocolError('control_frame_invalid');
  }
  const bytes = Buffer.from(`${JSON.stringify(parsed)}\n`, 'utf8');
  if (bytes.byteLength > SANDBOX_CONTROL_FRAME_MAX_BYTES) {
    throw new SandboxControlProtocolError('control_frame_oversized', bytes.byteLength);
  }
  return Uint8Array.from(bytes);
}

export function createSandboxControlFrameStateMachine(input: {
  readonly platform: NodeJS.Platform;
  readonly runToken: string;
}): SandboxControlFrameStateMachine {
  const runToken = parseSandboxRunToken(input.runToken);
  const acceptedFrames: SandboxControlFrameKind[] = [];
  const pendingLine: number[] = [];
  let expected: ExpectedFrameKind = 'ready';
  let evaluatorPid: number | undefined;
  let windowsCrLfPreambleObserved = false;
  let failure: SandboxControlProtocolError | undefined;

  function fail(error: SandboxControlProtocolError): never {
    failure ??= error;
    throw failure;
  }

  function currentSnapshot(): SandboxControlProtocolSnapshot {
    return Object.freeze({
      acceptedFrames: Object.freeze([...acceptedFrames]),
      ...(evaluatorPid === undefined ? {} : { evaluatorPid }),
      windowsCrLfPreambleObserved,
      completed: expected === 'complete',
    });
  }

  function acceptLine(line: Uint8Array): SandboxControlFrame | undefined {
    if (
      input.platform === 'win32'
      && acceptedFrames.length === 0
      && !windowsCrLfPreambleObserved
      && line.byteLength === 1
      && line[0] === 0x0d
    ) {
      windowsCrLfPreambleObserved = true;
      return undefined;
    }
    if (expected === 'complete') {
      return fail(new SandboxControlProtocolError(
        'control_stream_after_terminal',
        line.byteLength + 1,
      ));
    }

    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(line);
    } catch {
      return fail(new SandboxControlProtocolError('control_frame_invalid_utf8', line.byteLength));
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return fail(new SandboxControlProtocolError('control_frame_malformed_json', line.byteLength));
    }
    let frame: SandboxControlFrame;
    try {
      frame = parseControlFrame(value, line.byteLength);
    } catch (error) {
      if (error instanceof SandboxControlProtocolError) return fail(error);
      throw error;
    }
    if (frame.run_token !== runToken) {
      return fail(new SandboxControlProtocolError('control_frame_token_mismatch', line.byteLength));
    }
    if (frame.kind !== expected) {
      return fail(new SandboxControlProtocolError('control_frame_unexpected', line.byteLength));
    }
    if (evaluatorPid !== undefined && frame.pid !== evaluatorPid) {
      return fail(new SandboxControlProtocolError('control_frame_pid_mismatch', line.byteLength));
    }

    evaluatorPid ??= frame.pid;
    acceptedFrames.push(frame.kind);
    expected = frame.kind === 'ready'
      ? 'started'
      : frame.kind === 'started'
        ? 'result_committed'
        : 'complete';
    return frame;
  }

  return Object.freeze({
    accept(bytes: Uint8Array): readonly SandboxControlFrame[] {
      if (failure) throw failure;
      if (expected === 'complete' && bytes.byteLength > 0) {
        return fail(new SandboxControlProtocolError(
          'control_stream_after_terminal',
          bytes.byteLength,
        ));
      }

      const frames: SandboxControlFrame[] = [];
      for (const byte of bytes) {
        if (expected === 'complete') {
          return fail(new SandboxControlProtocolError(
            'control_stream_after_terminal',
            pendingLine.length + 1,
          ));
        }
        if (byte === 0x0a) {
          const frame = acceptLine(Uint8Array.from(pendingLine));
          pendingLine.length = 0;
          if (frame) frames.push(frame);
          continue;
        }
        // 4 KiB 预算包含最终换行；不能先缓存任意大 chunk 再检查。
        if (pendingLine.length >= SANDBOX_CONTROL_FRAME_MAX_BYTES - 1) {
          return fail(new SandboxControlProtocolError(
            'control_frame_oversized',
            pendingLine.length + 2,
          ));
        }
        pendingLine.push(byte);
      }
      return Object.freeze(frames);
    },

    finish(): SandboxControlProtocolSnapshot {
      if (failure) throw failure;
      if (pendingLine.length > 0) {
        return fail(new SandboxControlProtocolError(
          'control_frame_partial',
          pendingLine.length,
        ));
      }
      if (expected !== 'complete') {
        return fail(new SandboxControlProtocolError('control_sequence_incomplete'));
      }
      return currentSnapshot();
    },

    snapshot(): SandboxControlProtocolSnapshot {
      if (failure) throw failure;
      return currentSnapshot();
    },
  });
}

function parseControlFrame(value: unknown, byteLength: number): SandboxControlFrame {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SandboxControlProtocolError('control_frame_invalid', byteLength);
  }
  const keys = Object.keys(value);
  if (
    keys.length !== 4
    || !keys.includes('protocol_version')
    || !keys.includes('kind')
    || !keys.includes('run_token')
    || !keys.includes('pid')
  ) {
    throw new SandboxControlProtocolError('control_frame_invalid', byteLength);
  }
  const protocolVersion = Reflect.get(value, 'protocol_version');
  const kind = Reflect.get(value, 'kind');
  const runToken = Reflect.get(value, 'run_token');
  const pid = Reflect.get(value, 'pid');
  if (
    protocolVersion !== SANDBOX_CONTROL_PROTOCOL_VERSION
    || !isControlFrameKind(kind)
    || typeof runToken !== 'string'
    || typeof pid !== 'number'
    || !Number.isSafeInteger(pid)
    || pid <= 0
  ) {
    throw new SandboxControlProtocolError('control_frame_invalid', byteLength);
  }
  return {
    protocol_version: protocolVersion,
    kind,
    run_token: runToken,
    pid,
  };
}

function isControlFrameKind(value: unknown): value is SandboxControlFrameKind {
  return value === 'ready' || value === 'started' || value === 'result_committed';
}
