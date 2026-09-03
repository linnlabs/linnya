import { Console } from 'node:console';
import path from 'node:path';

interface AppServerBackendModule {
  readonly runLinnyaAppServerProcess: () => Promise<void>;
}

// Backend 大 bundle 可能在模块初始化阶段打印日志；必须先把全局 console 固定到 stderr，
// 再动态加载它，确保 stdout 从进程第一字节起只承载 control protocol。
Object.defineProperty(globalThis, 'console', {
  configurable: false,
  enumerable: true,
  writable: false,
  value: new Console({ stdout: process.stderr, stderr: process.stderr }),
});

const backendModule = parseBackendModule(
  require(path.join(__dirname, 'app-server-backend.cjs')),
);

void backendModule.runLinnyaAppServerProcess().then(() => {
  process.exitCode = 0;
}).catch((error: unknown) => {
  process.stderr.write(
    `[App Server] fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});

function parseBackendModule(value: unknown): AppServerBackendModule {
  if (typeof value !== 'object' || value === null) {
    throw new Error('App Server Backend module 不是对象');
  }
  const run = Reflect.get(value, 'runLinnyaAppServerProcess');
  if (typeof run !== 'function') {
    throw new Error('App Server Backend module 缺少 runLinnyaAppServerProcess');
  }
  return Object.freeze({ runLinnyaAppServerProcess: () => Promise.resolve(run()) });
}

