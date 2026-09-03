import type {
  WindowsOwnedPipeNativeEvent,
  WindowsOwnedPipeNativeOutputChannel,
} from '../definitions/windowsOwnedPipeNativeBinding';

function isAbsent(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function requireAbsent(value: unknown, field: string, event: string): void {
  if (!isAbsent(value)) {
    throw new Error(`Windows native ${event} event contains unexpected ${field}`);
  }
}

function parseOutputChannel(event: string): WindowsOwnedPipeNativeOutputChannel {
  if (event === 'stdout' || event === 'stdout_eof') return 'stdout';
  if (event === 'stderr' || event === 'stderr_eof') return 'stderr';
  throw new Error(`Windows native event is not an output channel: ${event}`);
}

/**
 * napi-rs 会把 Rust 四元组投影成“单个四元素数组”。这里是 wire 的唯一解析点，
 * 不能在 callback 调用处猜成四个位置参数，否则错误会直接破坏输出和终态顺序。
 */
export function parseWindowsOwnedPipeNativeEvent(
  payload: unknown,
): WindowsOwnedPipeNativeEvent {
  if (!Array.isArray(payload) || payload.length !== 4) {
    throw new Error('Windows native observer event must be one four-element array');
  }
  const [event, data, exitCode, error] = payload;
  if (typeof event !== 'string') {
    throw new Error('Windows native observer event type must be a string');
  }

  if (event === 'stdout' || event === 'stderr') {
    if (!(data instanceof Uint8Array)) {
      throw new Error(`Windows native ${event} event must contain bytes`);
    }
    requireAbsent(exitCode, 'exit code', event);
    requireAbsent(error, 'error', event);
    return { kind: 'data', channel: parseOutputChannel(event), bytes: data };
  }

  if (event === 'stdout_eof' || event === 'stderr_eof') {
    requireAbsent(data, 'data', event);
    requireAbsent(exitCode, 'exit code', event);
    requireAbsent(error, 'error', event);
    return { kind: 'eof', channel: parseOutputChannel(event) };
  }

  if (event === 'root_exit') {
    requireAbsent(data, 'data', event);
    requireAbsent(error, 'error', event);
    if (!Number.isSafeInteger(exitCode) || typeof exitCode !== 'number' || exitCode < 0) {
      throw new Error('Windows native root_exit event must contain a non-negative exit code');
    }
    return { kind: 'root_exit', exitCode };
  }

  if (event === 'observer_error') {
    requireAbsent(data, 'data', event);
    requireAbsent(exitCode, 'exit code', event);
    if (typeof error !== 'string' || error.length === 0) {
      throw new Error('Windows native observer_error event must contain a message');
    }
    return { kind: 'observer_error', message: error };
  }

  throw new Error(`Unknown Windows native observer event: ${event}`);
}
