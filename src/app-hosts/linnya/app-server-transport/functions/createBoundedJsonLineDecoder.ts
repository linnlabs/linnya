export interface BoundedJsonLineDecoder {
  push(chunk: Buffer | string): void;
  end(): void;
}

/**
 * App Server 各 JSONL 协议按原始 bytes 限流，不能先拼成无界字符串再检查。一个损坏或恶意 peer
 * 最多占用一帧预算；协议失败后 decoder 永久关闭，不猜测恢复边界。
 */
export function createBoundedJsonLineDecoder(input: {
  readonly protocolName: string;
  readonly maxFrameBytes: number;
  readonly onValue: (value: unknown) => void;
  readonly onFailure: (error: Error) => void;
}): BoundedJsonLineDecoder {
  let pending = Buffer.alloc(0);
  let failed = false;

  const fail = (error: Error): void => {
    if (failed) return;
    failed = true;
    pending = Buffer.alloc(0);
    input.onFailure(error);
  };

  const decode = (line: Buffer): void => {
    const normalized = line[line.byteLength - 1] === 0x0d ? line.subarray(0, -1) : line;
    if (normalized.byteLength === 0) {
      fail(new Error(`${input.protocolName} 不接受空帧`));
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(normalized.toString('utf8'));
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      fail(new Error(`${input.protocolName} JSON 无效：${detail}`));
      return;
    }
    input.onValue(parsed);
  };

  const appendPending = (bytes: Buffer): boolean => {
    if (pending.byteLength + bytes.byteLength >= input.maxFrameBytes) {
      fail(new Error(`${input.protocolName} frame 超过 ${input.maxFrameBytes} bytes`));
      return false;
    }
    pending = pending.byteLength === 0
      ? Buffer.from(bytes)
      : Buffer.concat([pending, bytes], pending.byteLength + bytes.byteLength);
    return true;
  };

  return Object.freeze({
    push(chunk: Buffer | string) {
      if (failed) return;
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      let offset = 0;
      let newlineIndex = bytes.indexOf(0x0a, offset);
      while (newlineIndex !== -1) {
        const segment = bytes.subarray(offset, newlineIndex);
        if (pending.byteLength + segment.byteLength + 1 > input.maxFrameBytes) {
          fail(new Error(`${input.protocolName} frame 超过 ${input.maxFrameBytes} bytes`));
          return;
        }
        const line = pending.byteLength === 0
          ? segment
          : Buffer.concat([pending, segment], pending.byteLength + segment.byteLength);
        pending = Buffer.alloc(0);
        decode(line);
        if (failed) return;
        offset = newlineIndex + 1;
        newlineIndex = bytes.indexOf(0x0a, offset);
      }
      if (offset < bytes.byteLength) appendPending(bytes.subarray(offset));
    },
    end() {
      if (failed) return;
      if (pending.byteLength > 0) {
        fail(new Error(`${input.protocolName} 以不完整帧结束`));
      }
    },
  });
}
