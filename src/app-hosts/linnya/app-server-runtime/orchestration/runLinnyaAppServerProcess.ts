import { Socket } from 'node:net';

import { readAppServerBootstrap } from '../../app-server-bootstrap';
import { runAppServerControlHost, type AppServerOwnedLifecycle } from '../../app-server-control';
import {
  createAppServerRpcPeer,
  type AppServerRpcHandler,
  type AppServerRpcHandlerRegistry,
} from '../../app-server-rpc';
import {
  createBackendRendererRequestRegistry,
  createBackendRendererRequestRpcHandlers,
  prepareBackendRendererRequestMailboxRoot,
  registerCoreBackendRendererRequestHandlers,
  resolveBackendRendererRequestMailboxRoot,
} from '../../adapters/backend-renderer-requests';
import {
  initializeAppServerBackend,
  shutdownAppServerBackend,
} from '../../backend-runtime/orchestration/backendLifecycle';
import { createHeadlessAppServerBackendComposition } from './createHeadlessAppServerBackendComposition';
import { createAppServerActivityRpcHandlers } from '../features/activity-rpc';
import { registerPluginCredentialRuntimePort } from '../../../../plugin-sdk/backend/pluginCredentialRuntime';
import { registerExportArtifactCommitPort } from '../../../../plugin-sdk/backend/exportArtifact';
import { enableDiagnosticLogForwarding, Logger } from '../../../../shared/logger';
import { createAppServerDiagnosticLogForwarder } from '../features/diagnostic-log-rpc';
import { createNodeEventLoopResponsivenessMonitor } from '../../../../infra/observability/event-loop';
import { acquireWorkspaceRuntimeOwnership } from '../../backend-runtime/features/workspace-ownership/acquireWorkspaceRuntimeOwnership';

/**
 * fd 3/4/5 分别是 bootstrap、child→Main RPC 与 Main→child RPC。完整 Backend 只在本进程创建；
 * stdout 已由外层 tiny launcher 保证为 control protocol 专用。
 */
export async function runLinnyaAppServerProcess(): Promise<void> {
  const bootstrapInput = new Socket({ fd: 3, readable: true, writable: false });
  const bootstrap = await readAppServerBootstrap(bootstrapInput);
  bootstrapInput.destroy();

  // 在任何数据库恢复或 GC 前排除第二个活 owner；退出失败也不能提前让出 Workspace。
  const workspaceOwnership = acquireWorkspaceRuntimeOwnership(
    bootstrap.backend_facts.runtimePathRoots.workspaceRoot
  );
  process.once('exit', () => workspaceOwnership.release());

  const rpcOutput = new Socket({ fd: 4, readable: false, writable: true });
  const rpcInput = new Socket({ fd: 5, readable: true, writable: false });
  const rpcHandlers = new Map<string, AppServerRpcHandler>();
  const rpc = createAppServerRpcPeer({
    input: rpcInput,
    output: rpcOutput,
    handlers: rpcHandlers,
  });
  enableDiagnosticLogForwarding(
    createAppServerDiagnosticLogForwarder(rpc, error => {
      console.error('[App Server] 诊断日志转发失败', error);
    })
  );
  const responsivenessLogger = new Logger('App-Server-Responsiveness');
  const responsivenessMonitor = createNodeEventLoopResponsivenessMonitor({
    component: 'app-server',
    sampleIntervalMs: 5_000,
    histogramResolutionMs: 20,
    thresholds: {
      p99DelayMs: 50,
      maximumDelayMs: 200,
    },
    onSample(sample) {
      if (sample.thresholdExceeded) {
        responsivenessLogger.warn('[Responsiveness] App Server 事件循环超过响应性门禁', sample);
      }
    },
  });
  responsivenessMonitor.start();
  const mailboxRoot = resolveBackendRendererRequestMailboxRoot(
    bootstrap.backend_facts.runtimePathRoots.appDataRoot
  );
  await prepareBackendRendererRequestMailboxRoot(mailboxRoot);

  let composition: ReturnType<typeof createHeadlessAppServerBackendComposition> | null = null;
  let shutdownSettlement: Promise<void> | null = null;
  const ready = (async () => {
    composition = createHeadlessAppServerBackendComposition({
      bootstrap,
      rpc,
      mailboxRoot,
      reportAsyncFailure(error) {
        console.error('[App Server] 异步 Desktop capability 失败', error);
      },
    });
    registerRpcHandlers(rpcHandlers, composition.backendRpcHandlers);
    registerExportArtifactCommitPort(composition.exportArtifactCommit);
    registerPluginCredentialRuntimePort(composition.pluginCredentialRuntime);

    const runtimeOwner = await initializeAppServerBackend(
      bootstrap.backend_configuration,
      composition.backendHostDependencies
    );
    registerRpcHandlers(rpcHandlers, createAppServerActivityRpcHandlers(runtimeOwner));
    const rendererRequests = createBackendRendererRequestRegistry();
    await registerCoreBackendRendererRequestHandlers({
      runtimeOwner,
      registry: rendererRequests,
      credentialProtection: composition.backendHostDependencies.credentialProtection,
      rendererIntegration: composition.backendHostDependencies.rendererIntegration,
      applicationVersion: bootstrap.backend_facts.applicationVersion,
      packaged: bootstrap.backend_facts.packaged,
      distributionIdentity: bootstrap.backend_facts.distributionIdentity,
      fileReveal: composition.fileReveal,
    });
    registerRpcHandlers(
      rpcHandlers,
      createBackendRendererRequestRpcHandlers({
        registry: rendererRequests,
        mailboxRoot,
      })
    );
    const apiPort = runtimeOwner.getPort();
    if (apiPort === null) throw new Error('App Server Backend ready 时缺少实际 API port');
    return Object.freeze({
      applicationVersion: bootstrap.backend_facts.applicationVersion,
      apiPort,
      rendererSessionToken: runtimeOwner.getToken(),
      databaseReady: true as const,
    });
  })();

  const lifecycle: AppServerOwnedLifecycle = {
    ready,
    shutdown() {
      if (shutdownSettlement) return shutdownSettlement;
      shutdownSettlement = (async () => {
        // 等启动成功或失败完成自己的 rollback，随后只关闭当前进程内唯一 Backend owner。
        await ready.catch(() => undefined);
        const failures: unknown[] = [];
        try {
          await shutdownAppServerBackend();
        } catch (error: unknown) {
          failures.push(error);
        }
        responsivenessMonitor.stop();
        composition?.dispose();
        rpc.dispose(new Error('App Server Backend owner 正在关闭'));
        if (failures.length > 0) throw failures[0];
      })();
      return shutdownSettlement;
    },
  };
  const controlHost = runAppServerControlHost({
    input: process.stdin,
    output: process.stdout,
    lifecycle,
  });
  void rpc.completed.catch((error: unknown) => {
    const failure = toError(error);
    console.error('[App Server] RPC 数据面失败', failure);
    process.stdin.destroy(failure);
  });

  process.stdin.resume();
  await controlHost.completed;
  await waitForReadableEnd(rpcInput);
  await endSocket(rpcOutput);
}

function registerRpcHandlers(
  target: Map<string, AppServerRpcHandler>,
  source: AppServerRpcHandlerRegistry
): void {
  for (const [method, handler] of source) {
    if (target.has(method)) throw new Error(`App Server RPC method 重复注册: ${method}`);
    target.set(method, handler);
  }
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

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
