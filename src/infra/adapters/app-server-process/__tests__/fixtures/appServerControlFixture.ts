import { Socket } from 'node:net';

import { readAppServerBootstrap } from '../../../../../app-hosts/linnya/app-server-bootstrap';
import {
  runAppServerControlHost,
} from '../../../../../app-hosts/linnya/app-server-control';
import {
  createAppServerRpcPeer,
  type AppServerRpcHandler,
  type AppServerRpcHandlerRegistry,
} from '../../../../../app-hosts/linnya/app-server-rpc';
import { installAppServerChildSignalOwnership } from '../../../../../app-hosts/linnya/app-server-runtime/functions/installAppServerChildSignalOwnership';
import { describeAppServerStartupFailure } from '../../../../../app-hosts/linnya/app-server-runtime/functions/describeAppServerStartupFailure';

async function main(): Promise<void> {
  const signalOwnership = installAppServerChildSignalOwnership();
  // child_process 的额外 stdio fd 是非阻塞 IPC pipe，必须按 Node 文档用 net.Socket 读取。
  const bootstrapInput = new Socket({ fd: 3, readable: true, writable: false });
  const bootstrap = await readAppServerBootstrap(bootstrapInput);
  bootstrapInput.destroy();
  const rpcOutput = new Socket({ fd: 4, readable: false, writable: true });
  const rpcInput = new Socket({ fd: 5, readable: true, writable: false });
  const handlers: AppServerRpcHandlerRegistry = new Map<string, AppServerRpcHandler>([
    ['backend.fixture.echo', payload => payload],
    ['backend.fixture.wait', (_payload, context) => new Promise<never>((_resolve, reject) => {
      process.stderr.write('fixture-rpc-handler-started\n');
      context.signal.addEventListener('abort', () => {
        process.stderr.write('fixture-rpc-handler-aborted\n');
        reject(new Error('fixture request aborted'));
      }, { once: true });
    })],
  ]);
  const rpc = createAppServerRpcPeer({
    input: rpcInput,
    output: rpcOutput,
    handlers,
  });
  const databaseStartupMs = readNumberArgument('--database-startup-ms');
  const readyDelayAfterDatabaseMs = readNumberArgument('--ready-delay-after-database-ms');
  const startupFailureCode = readStringArgument('--startup-failure-code');
  const ready = rpc.request('desktop.fixture.echo', { from: 'backend' }).then(async result => {
    if (typeof result !== 'object'
      || result === null
      || Array.isArray(result)
      || result.acknowledged !== true) {
      throw new Error('Desktop reverse RPC 返回了无效确认');
    }
    if (databaseStartupMs !== null) {
      // 模拟耗时超过启动超时的数据格式升级：两个步骤，各占一半时间。
      await host.reportStartupProgress({ state: 'started', upgrading: true, completedSteps: 0, totalSteps: 2 });
      await delay(databaseStartupMs / 2);
      await host.reportStartupProgress({ state: 'progress', upgrading: true, completedSteps: 1, totalSteps: 2 });
      await delay(databaseStartupMs / 2);
      await host.reportStartupProgress({ state: 'progress', upgrading: true, completedSteps: 2, totalSteps: 2 });
      await host.reportStartupProgress({ state: 'finished', upgrading: true, completedSteps: 2, totalSteps: 2 });
    }
    if (readyDelayAfterDatabaseMs !== null) await delay(readyDelayAfterDatabaseMs);
    if (startupFailureCode !== null) {
      // 模拟启动阶段的 SQLite / 系统错误，验证类别经控制帧到达宿主。
      throw Object.assign(new Error(`fixture startup failure ${startupFailureCode}`), {
        code: startupFailureCode,
      });
    }
    return {
      applicationVersion: bootstrap.backend_facts.applicationVersion,
      apiPort: bootstrap.backend_configuration.server.port,
      rendererSessionToken: 'f'.repeat(64),
      databaseReady: true as const,
    };
  });
  // stdout 是控制协议专用数据面；fixture 的可观察日志与正式 App Server 一样只走 stderr。
  const host = runAppServerControlHost({
    describeStartupFailure: describeAppServerStartupFailure,
    input: process.stdin,
    output: process.stdout,
    lifecycle: {
      ready,
      async shutdown() {
        rpc.dispose(new Error('fixture owner 正在关闭'));
        process.stderr.write('fixture-owner-shutdown\n');
      },
    },
  });

  process.stdin.resume();
  await host.completed;
  await waitForReadableEnd(rpcInput);
  await endSocket(rpcOutput);
  signalOwnership.dispose();
  if (process.argv.includes('--retain-shutdown-timer')) {
    // 模拟业务已 ACK、但后台维护忘记取消定时器的真实故障。
    setInterval(() => undefined, 60_000);
  }
}

void main().then(() => {
  process.exitCode = 0;
}).catch((error: unknown) => {
  process.stderr.write(`fixture-failure:${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

function readNumberArgument(name: string): number | null {
  const argument = process.argv.find(value => value.startsWith(`${name}=`));
  if (!argument) return null;
  const value = Number(argument.slice(name.length + 1));
  if (!Number.isFinite(value) || value < 0) throw new Error(`fixture 参数无效：${argument}`);
  return value;
}

function readStringArgument(name: string): string | null {
  const argument = process.argv.find(value => value.startsWith(`${name}=`));
  return argument ? argument.slice(name.length + 1) : null;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function waitForReadableEnd(input: Socket): Promise<void> {
  if (input.readableEnded || input.destroyed) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    input.once('end', resolve);
    input.once('error', reject);
  });
}

function endSocket(output: Socket): Promise<void> {
  if (output.destroyed || output.writableEnded) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    output.once('error', reject);
    output.end(resolve);
  });
}
