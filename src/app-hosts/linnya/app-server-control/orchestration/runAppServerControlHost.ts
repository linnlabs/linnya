import { randomUUID } from 'node:crypto';
import type { Readable, Writable } from 'node:stream';

import {
  APP_SERVER_CONTROL_MAX_FRAME_BYTES,
  APP_SERVER_CONTROL_PROTOCOL_VERSION,
  APP_SERVER_CONTROL_SCHEMA_VERSION,
  type AppServerChildControlFrame,
  type AppServerControlRequestFrame,
} from '../definitions/appServerControlProtocol';
import type { AppServerOwnedLifecycle } from '../definitions/appServerOwnedLifecycle';
import { parseAppServerParentControlFrame } from '../functions/appServerControlCodec';
import { createAppServerControlWriter } from '../functions/createAppServerControlWriter';
import { createBoundedJsonLineDecoder } from '../../app-server-transport';

export interface AppServerControlHost {
  readonly daemonEpoch: string;
  readonly completed: Promise<void>;
}

/**
 * stdin/stdout 只承载 App Server 控制面。stdin EOF 是跨平台 parent-death signal：
 * Electron Main 消失后 pipe 会关闭，daemon 必须结束所有业务 owner，不能继续后台任务。
 */
export function runAppServerControlHost(input: {
  readonly input: Readable;
  readonly output: Writable;
  readonly lifecycle: AppServerOwnedLifecycle;
  readonly pid?: number;
  readonly daemonEpoch?: string;
}): AppServerControlHost {
  const daemonEpoch = input.daemonEpoch ?? randomUUID();
  const pid = input.pid ?? process.pid;
  let shutdownSettlement: Promise<void> | null = null;
  let acceptingRequests = true;
  let completedResolve: (() => void) | null = null;
  let completedReject: ((error: Error) => void) | null = null;
  const completed = new Promise<void>((resolve, reject) => {
    completedResolve = resolve;
    completedReject = reject;
  });
  const failOutput = (error: unknown): void => {
    const failure = toError(error);
    acceptingRequests = false;
    completedReject?.(failure);
    void shutdown('protocol_failure');
  };

  const writer = createAppServerControlWriter({
    output: input.output,
    onFailure: failOutput,
  });

  const write = (frame: AppServerChildControlFrame): Promise<void> => writer.write(frame);

  const shutdown = (
    reason: 'request' | 'parent_eof' | 'protocol_failure',
    request?: AppServerControlRequestFrame,
  ): Promise<void> => {
    if (shutdownSettlement) return shutdownSettlement;
    shutdownSettlement = input.lifecycle.shutdown().then(async () => {
      if (reason === 'request' && request) {
        await write({
          schema_version: APP_SERVER_CONTROL_SCHEMA_VERSION,
          kind: 'response',
          request_id: request.request_id,
          operation: request.operation,
          daemon_epoch: daemonEpoch,
        });
      }
      completedResolve?.();
    }).catch(async (error: unknown) => {
      const failure = toError(error);
      try {
        await write({
          schema_version: APP_SERVER_CONTROL_SCHEMA_VERSION,
          kind: 'fatal',
          code: 'shutdown_failed',
          message: `${reason}: ${failure.message}`,
        });
      } catch {
        // stdout 自身失败时已经没有可用的控制数据面；原始 failure 仍是权威终态。
      }
      completedReject?.(failure);
    });
    return shutdownSettlement;
  };

  const decoder = createBoundedJsonLineDecoder({
    protocolName: 'App Server control protocol',
    maxFrameBytes: APP_SERVER_CONTROL_MAX_FRAME_BYTES,
    onValue(value) {
      if (!acceptingRequests) return;
      let frame;
      try {
        frame = parseAppServerParentControlFrame(value);
      } catch (error: unknown) {
        const failure = error instanceof Error ? error : new Error(String(error));
        void write({
          schema_version: APP_SERVER_CONTROL_SCHEMA_VERSION,
          kind: 'fatal',
          code: 'protocol_failed',
          message: failure.message,
        }).catch(failOutput);
        acceptingRequests = false;
        void shutdown('protocol_failure');
        return;
      }
      if (frame.operation === 'ping') {
        void write({
          schema_version: APP_SERVER_CONTROL_SCHEMA_VERSION,
          kind: 'response',
          request_id: frame.request_id,
          operation: frame.operation,
          daemon_epoch: daemonEpoch,
        }).catch(failOutput);
        return;
      }
      acceptingRequests = false;
      void shutdown('request', frame);
    },
    onFailure(error) {
      acceptingRequests = false;
      void write({
        schema_version: APP_SERVER_CONTROL_SCHEMA_VERSION,
        kind: 'fatal',
        code: 'protocol_failed',
        message: error.message,
      }).catch(failOutput);
      void shutdown('protocol_failure');
    },
  });

  input.input.on('data', chunk => {
    if (Buffer.isBuffer(chunk) || typeof chunk === 'string') decoder.push(chunk);
  });
  input.input.once('end', () => {
    acceptingRequests = false;
    decoder.end();
    void shutdown('parent_eof');
  });
  input.input.once('error', error => {
    acceptingRequests = false;
    completedReject?.(error);
    void shutdown('parent_eof');
  });

  void input.lifecycle.ready.then((ready) => {
    if (shutdownSettlement) return;
    return write({
      schema_version: APP_SERVER_CONTROL_SCHEMA_VERSION,
      kind: 'ready',
      protocol_version: APP_SERVER_CONTROL_PROTOCOL_VERSION,
      daemon_epoch: daemonEpoch,
      pid,
      application_version: ready.applicationVersion,
      api_port: ready.apiPort,
      renderer_session_token: ready.rendererSessionToken,
      database_ready: ready.databaseReady,
    });
  }).catch((error: unknown) => {
    const failure = toError(error);
    void write({
      schema_version: APP_SERVER_CONTROL_SCHEMA_VERSION,
      kind: 'fatal',
      code: 'startup_failed',
      message: failure.message,
    }).catch(() => undefined);
    completedReject?.(failure);
    void shutdown('protocol_failure');
  });

  return Object.freeze({ daemonEpoch, completed });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
