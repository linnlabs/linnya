export const SANDBOX_CONTROL_PROTOCOL_VERSION = 1;
export const SANDBOX_CONTROL_FRAME_MAX_BYTES = 4 * 1024;

export type SandboxControlFrameKind = 'ready' | 'started' | 'result_committed';

export interface SandboxControlFrame {
  readonly protocol_version: typeof SANDBOX_CONTROL_PROTOCOL_VERSION;
  readonly kind: SandboxControlFrameKind;
  readonly run_token: string;
  readonly pid: number;
}

export type SandboxControlProtocolErrorCode =
  | 'control_frame_oversized'
  | 'control_frame_partial'
  | 'control_frame_invalid_utf8'
  | 'control_frame_malformed_json'
  | 'control_frame_invalid'
  | 'control_frame_token_mismatch'
  | 'control_frame_pid_mismatch'
  | 'control_frame_unexpected'
  | 'control_sequence_incomplete'
  | 'control_stream_after_terminal';

/** 控制流错误同样不得保留可能来自用户载荷的原始 frame。 */
export class SandboxControlProtocolError extends Error {
  constructor(
    readonly code: SandboxControlProtocolErrorCode,
    readonly byteLength?: number,
  ) {
    super(byteLength === undefined
      ? `Sandbox control protocol failed: ${code}`
      : `Sandbox control protocol failed: ${code}; bytes=${byteLength}`);
    this.name = 'SandboxControlProtocolError';
  }
}

export interface SandboxControlProtocolSnapshot {
  readonly acceptedFrames: readonly SandboxControlFrameKind[];
  readonly evaluatorPid?: number;
  readonly windowsCrLfPreambleObserved: boolean;
  readonly completed: boolean;
}

export interface SandboxControlFrameStateMachine {
  accept(bytes: Uint8Array): readonly SandboxControlFrame[];
  finish(): SandboxControlProtocolSnapshot;
  snapshot(): SandboxControlProtocolSnapshot;
}
