import type { Writable } from 'node:stream';

import {
  type AppServerChildControlFrame,
} from '../definitions/appServerControlProtocol';
import { encodeAppServerControlFrame } from './appServerControlCodec';

const DEFAULT_MAX_PENDING_WRITES = 8;

export interface AppServerControlWriter {
  write(frame: AppServerChildControlFrame): Promise<void>;
}

/**
 * stdout 是控制协议的数据面。写入必须串行并等待 Writable callback，确保 pipe 背压
 * 真的传回生命周期编排；容量上限则阻止异常 parent 把响应积压成无界 Promise 队列。
 */
export function createAppServerControlWriter(input: {
  readonly output: Writable;
  readonly maxPendingWrites?: number;
  readonly onFailure?: (error: Error) => void;
}): AppServerControlWriter {
  const maxPendingWrites = input.maxPendingWrites ?? DEFAULT_MAX_PENDING_WRITES;
  if (!Number.isSafeInteger(maxPendingWrites) || maxPendingWrites <= 0) {
    throw new Error('App Server control writer 容量必须是正整数');
  }

  let pendingWrites = 0;
  let outputFailure: Error | null = null;
  let writeTail: Promise<void> = Promise.resolve();

  input.output.once('error', (error: Error) => {
    if (outputFailure) return;
    outputFailure = error;
    input.onFailure?.(error);
  });

  return Object.freeze({
    write(frame: AppServerChildControlFrame) {
      if (outputFailure) return Promise.reject(outputFailure);
      if (pendingWrites >= maxPendingWrites) {
        return Promise.reject(new Error('App Server control writer 已达容量上限'));
      }
      pendingWrites += 1;
      const bytes = encodeAppServerControlFrame(frame);
      const settlement = writeTail.then(async () => {
        if (outputFailure) throw outputFailure;
        await writeBytes(input.output, bytes);
      });
      writeTail = settlement.catch((error: unknown) => {
        if (!outputFailure) {
          outputFailure = toError(error);
          input.onFailure?.(outputFailure);
        }
      });
      return settlement.finally(() => {
        pendingWrites -= 1;
      });
    },
  });
}

function writeBytes(output: Writable, bytes: Buffer): Promise<void> {
  if (output.destroyed || output.writableEnded) {
    return Promise.reject(new Error('App Server control stdout 已关闭'));
  }
  return new Promise<void>((resolve, reject) => {
    try {
      output.write(bytes, (error?: Error | null) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    } catch (error: unknown) {
      reject(toError(error));
    }
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
