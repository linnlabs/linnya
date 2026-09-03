import path from 'node:path';

import { app, utilityProcess, type ForkOptions } from 'electron';

import type {
  SandboxUtilityProcessForkPort,
  SandboxUtilityProcessForkRequest,
} from '../../../../app-hosts/linnya/adapters/sandbox/production-runtime';
import type {
  SandboxUtilityProcessLike,
} from '../../../../app-hosts/linnya/adapters/sandbox/production-runtime/definitions/sandboxUtilityProcessTransport';

/**
 * 正式 App 关闭了 RunAsNode，因此这里只能使用 Electron UtilityProcess。把 Electron
 * 对象收窄后交给 transport，可避免 production scope 依赖 EventEmitter 的宽接口。
 */
export function createElectronSandboxUtilityProcessFork(): SandboxUtilityProcessForkPort {
  return Object.freeze({
    fork(request: SandboxUtilityProcessForkRequest): SandboxUtilityProcessLike {
      if (!app.isReady()) {
        throw new Error('sandbox utility process requires Electron app ready');
      }
      if (!path.isAbsolute(request.utilityPath)) {
        throw new Error('sandbox utility process path must be absolute');
      }
      const options = {
        env: { ...request.environment },
        execArgv: [],
        serviceName: 'Linnya Sandbox Runner',
        stdio: ['ignore', 'ignore', 'pipe'],
      } satisfies ForkOptions;
      const child = utilityProcess.fork(request.utilityPath, [...request.argv], options);
      return {
        stderr: child.stderr,
        postMessage: (message: unknown) => child.postMessage(message),
        kill: () => child.kill(),
        onMessage: (listener: (message: unknown) => void) => {
          child.on('message', listener);
        },
        onceExit: (listener: (exitCode: number) => void) => {
          child.once('exit', listener);
        },
        onceError: listener => {
          child.once('error', (type, location) => {
            listener(new Error(
              `sandbox utility process fatal error: ${type} at ${location}`,
            ));
          });
        },
      };
    },
  });
}
