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

async function main(): Promise<void> {
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
  const ready = rpc.request('desktop.fixture.echo', { from: 'backend' }).then(result => {
    if (typeof result !== 'object'
      || result === null
      || Array.isArray(result)
      || result.acknowledged !== true) {
      throw new Error('Desktop reverse RPC 返回了无效确认');
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
}

void main().then(() => {
  process.exitCode = 0;
}).catch((error: unknown) => {
  process.stderr.write(`fixture-failure:${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

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
