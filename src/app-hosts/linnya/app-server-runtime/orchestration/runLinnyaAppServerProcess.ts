import { Socket } from 'node:net';
import type { Writable } from 'node:stream';

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
import { createParentProcessLivenessMonitor } from '../functions/createParentProcessLivenessMonitor';

/**
 * fd 3/4/5 分别是 bootstrap、child→Main RPC 与 Main→child RPC。完整 Backend 只在本进程创建；
 * stdout 已由外层 tiny launcher 保证为 control protocol 专用。
 */
export async function runLinnyaAppServerProcess(): Promise<void> {
  const bootstrapInput = new Socket({ fd: 3, readable: true, writable: false });
  const bootstrap = await readAppServerBootstrap(bootstrapInput);
  bootstrapInput.destroy();

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
  let parentLiveness: ReturnType<typeof createParentProcessLivenessMonitor> | null = null;
  let workspaceOwnership: ReturnType<typeof acquireWorkspaceRuntimeOwnership> | null = null;
  let shutdownSettlement: Promise<void> | null = null;
  const ready = (async () => {
    // 先建立 control host，再在任何数据库恢复或 GC 前排除第二个活 owner。
    // 获取失败会成为有结构的 startup fatal 帧，而不是被 RPC EOF 抹成泛化错误。
    workspaceOwnership = acquireWorkspaceRuntimeOwnership(
      bootstrap.backend_facts.runtimePathRoots.workspaceRoot
    );
    process.once('exit', () => workspaceOwnership?.release());
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
        parentLiveness?.dispose();
        composition?.dispose();
        rpc.dispose(new Error('App Server Backend owner 正在关闭'));
        if (failures.length > 0) throw failures[0];
        workspaceOwnership?.release();
        workspaceOwnership = null;
      })();
      return shutdownSettlement;
    },
  };
  const controlHost = runAppServerControlHost({
    input: process.stdin,
    output: process.stdout,
    lifecycle,
  });
  parentLiveness = createParentProcessLivenessMonitor({
    expectedParentPid: bootstrap.host_process.pid,
    onParentLost() {
      // 走 control input error 的统一收口路径；不在 monitor 内直接操作业务 owner。
      process.stdin.destroy(new Error('App Server parent process 已退出'));
    },
  });
  parentLiveness.start();
  void rpc.completed.catch((error: unknown) => {
    const failure = toError(error);
    console.error('[App Server] RPC 数据面失败', failure);
    process.stdin.destroy(failure);
  });

  process.stdin.resume();
  await controlHost.completed;
  // lifecycle.shutdown 已先 dispose RPC 业务请求。部分平台在 parent SIGKILL 后不会
  // 为额外 pipe 投递 EOF，继续等待 readable end 会让已收口 Backend 永久占住 Workspace lock。
  rpcInput.destroy();
  await endSocket(rpcOutput);
  await endSocket(process.stdout);
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

function endSocket(output: Writable): Promise<void> {
  if (output.destroyed || output.writableEnded) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    output.once('error', reject);
    output.end(resolve);
  });
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
