import type { Readable } from 'node:stream';

import type { AppServerBootstrap } from '../definitions/appServerBootstrap';
import { APP_SERVER_BOOTSTRAP_MAX_FRAME_BYTES } from '../definitions/appServerBootstrap';
import { parseAppServerBootstrap } from '../functions/appServerBootstrapCodec';
import { createBoundedJsonLineDecoder } from '../../app-server-transport';

/** dedicated bootstrap pipe 必须恰好包含一个完整帧，并在帧后 EOF。 */
export function readAppServerBootstrap(input: Readable): Promise<AppServerBootstrap> {
  return new Promise((resolve, reject) => {
    let bootstrap: AppServerBootstrap | null = null;
    let failed = false;
    const fail = (error: Error): void => {
      if (failed) return;
      failed = true;
      reject(error);
    };
    const decoder = createBoundedJsonLineDecoder({
      protocolName: 'App Server bootstrap protocol',
      maxFrameBytes: APP_SERVER_BOOTSTRAP_MAX_FRAME_BYTES,
      onValue(value) {
        if (bootstrap) {
          fail(new Error('App Server bootstrap pipe 包含多个帧'));
          return;
        }
        try {
          bootstrap = parseAppServerBootstrap(value);
        } catch (error: unknown) {
          fail(toError(error));
        }
      },
      onFailure: fail,
    });
    input.on('data', chunk => {
      if (Buffer.isBuffer(chunk) || typeof chunk === 'string') decoder.push(chunk);
    });
    input.once('error', error => fail(error));
    input.once('end', () => {
      decoder.end();
      if (failed) return;
      if (!bootstrap) {
        fail(new Error('App Server bootstrap pipe 未提供启动帧'));
        return;
      }
      resolve(bootstrap);
    });
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
