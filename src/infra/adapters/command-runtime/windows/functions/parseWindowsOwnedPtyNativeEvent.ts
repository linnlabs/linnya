import type { WindowsOwnedPtyNativeEvent } from '../definitions/windowsOwnedPtyNativeBinding';

function requireAbsent(value: unknown, field: string, event: string): void {
  if (value !== null && value !== undefined) {
    throw new Error(`Windows native ${event} event contains unexpected ${field}`);
  }
}

/** napi-rs 把 Rust 四元组投影为单个四元素数组；PTY 与 pipe 各自严格解析自己的事件。 */
export function parseWindowsOwnedPtyNativeEvent(payload: unknown): WindowsOwnedPtyNativeEvent {
  if (!Array.isArray(payload) || payload.length !== 4) {
    throw new Error('Windows native PTY observer event must be one four-element array');
  }
  const [event, data, exitCode, error] = payload;
  if (typeof event !== 'string') {
    throw new Error('Windows native PTY observer event type must be a string');
  }
  if (event === 'terminal_data') {
    if (!(data instanceof Uint8Array)) {
      throw new Error('Windows native terminal_data event must contain transcript bytes');
    }
    requireAbsent(exitCode, 'exit code', event);
    requireAbsent(error, 'error', event);
    return { kind: 'terminal_data', bytes: data };
  }
  if (event === 'terminal_eof') {
    requireAbsent(data, 'data', event);
    requireAbsent(exitCode, 'exit code', event);
    requireAbsent(error, 'error', event);
    return { kind: 'terminal_eof' };
  }
  if (event === 'root_exit') {
    requireAbsent(data, 'data', event);
    requireAbsent(error, 'error', event);
    if (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode) || exitCode < 0) {
      throw new Error('Windows native PTY root_exit event must contain a non-negative exit code');
    }
    return { kind: 'root_exit', exitCode };
  }
  if (event === 'observer_error') {
    requireAbsent(data, 'data', event);
    requireAbsent(exitCode, 'exit code', event);
    if (typeof error !== 'string' || error.length === 0) {
      throw new Error('Windows native PTY observer_error event must contain a message');
    }
    return { kind: 'observer_error', message: error };
  }
  throw new Error(`Unknown Windows native PTY observer event: ${event}`);
}
