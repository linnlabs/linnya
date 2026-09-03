import type { Writable } from 'node:stream';

import {
  APP_SERVER_RPC_MAX_PENDING_WRITES,
  type AppServerRpcFrame,
} from '../definitions/appServerRpcProtocol';
import { encodeAppServerRpcFrame } from './appServerRpcCodec';

export type AppServerRpcWritePriority = 'urgent' | 'normal';

export interface AppServerRpcWriter {
  write(frame: AppServerRpcFrame, priority: AppServerRpcWritePriority): Promise<void>;
}

interface WriteJob {
  readonly bytes: Buffer;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
}

/** response/cancel 优先，避免普通 request 洪峰饿死 terminal control。 */
export function createAppServerRpcWriter(input: {
  readonly output: Writable;
  readonly onFailure: (error: Error) => void;
}): AppServerRpcWriter {
  const urgent: WriteJob[] = [];
  const normal: WriteJob[] = [];
  let active = false;
  let failure: Error | null = null;

  const failQueues = (error: Error): void => {
    if (failure) return;
    failure = error;
    for (const job of [...urgent.splice(0), ...normal.splice(0)]) job.reject(error);
    input.onFailure(error);
  };

  input.output.once('error', (error: Error) => failQueues(error));

  const pump = (): void => {
    if (active || failure) return;
    const job = urgent.shift() ?? normal.shift();
    if (!job) return;
    active = true;
    void writeBytes(input.output, job.bytes).then(() => {
      job.resolve();
    }).catch((error: unknown) => {
      const normalized = toError(error);
      job.reject(normalized);
      failQueues(normalized);
    }).finally(() => {
      active = false;
      pump();
    });
  };

  return Object.freeze({
    write(frame: AppServerRpcFrame, priority: AppServerRpcWritePriority) {
      if (failure) return Promise.reject(failure);
      const pendingCount = urgent.length + normal.length + (active ? 1 : 0);
      if (pendingCount >= APP_SERVER_RPC_MAX_PENDING_WRITES) {
        return Promise.reject(new Error('App Server RPC writer 已达容量上限'));
      }
      let bytes: Buffer;
      try {
        bytes = encodeAppServerRpcFrame(frame);
      } catch (error: unknown) {
        return Promise.reject(toError(error));
      }
      return new Promise<void>((resolve, reject) => {
        const queue = priority === 'urgent' ? urgent : normal;
        queue.push({ bytes, resolve, reject });
        pump();
      });
    },
  });
}

function writeBytes(output: Writable, bytes: Buffer): Promise<void> {
  if (output.destroyed || output.writableEnded) {
    return Promise.reject(new Error('App Server RPC output 已关闭'));
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
