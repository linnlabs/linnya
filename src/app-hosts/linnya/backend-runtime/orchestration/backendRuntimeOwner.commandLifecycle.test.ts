import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../electron-main/services/apiServer', () => ({
  ApiServer: class TestApiServer {
    setupMiddleware(): void {}
    async start(port: number): Promise<number> { return port; }
    async stop(): Promise<void> {}
    getToken(): string { return 'test-token'; }
  },
}));

vi.mock('../../../../electron-main/services/serviceInitializer', () => ({
  ServiceInitializer: class TestServiceInitializer {
    async initializeServices(): Promise<never> {
      throw new Error('initializeServices test implementation is required');
    }
  },
}));

vi.mock('../../../../electron-main/services/qdrantManager', () => ({
  QdrantManager: class TestQdrantManager {
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    getConfig(): Record<string, never> { return {}; }
  },
}));

import { QueueManager } from '../../../../infra/task-queue/queues';
import { QdrantManager } from '../../../../electron-main/services/qdrantManager';
import { ServiceInitializer } from '../../../../electron-main/services/serviceInitializer';
import {
  BackendRuntimeOwner,
  BackendRuntimeShutdownError,
  BackendRuntimeStartupError,
} from './backendRuntimeOwner';

const BACKEND_CONFIGURATION = Object.freeze({
  qdrant: Object.freeze({ host: '127.0.0.1', port: 6333 }),
  server: Object.freeze({ port: 34000 }),
});

class TestBackendRuntimeOwner extends BackendRuntimeOwner {
  constructor() {
    super({
      binaryPath: '/test/runtime/qdrant',
      platform: 'darwin',
      environment: Object.freeze({}),
    }, async () => {
      throw new Error('test Qdrant process owner must not launch');
    }, Object.freeze({
      ingestionScriptPath: '/test/runtime/ingestion.worker.cjs',
      audioProcessingScriptPath: '/test/runtime/audio-processing.worker.cjs',
      graphExtractionScriptPath: '/test/runtime/graph-extraction.worker.cjs',
      graphIndexingScriptPath: '/test/runtime/graph-indexing.worker.cjs',
    }), Object.freeze({
      developmentRoot: '/workspace/linnya',
      appDataRoot: '/workspace/linnya/_dev_data',
      workspaceRoot: '/workspace/linnya/_dev_data',
      workspaceRootIsCustom: false,
    }), '0.0.38');
  }
}

afterEach(() => vi.restoreAllMocks());

describe('BackendRuntimeOwner command owner lifecycle', () => {
  it('服务初始化失败时收口已经启动的 Qdrant 和后台队列，再传播原始失败', async () => {
    const initializationFailure = new Error('service initialization failed');
    const qdrantStop = vi.spyOn(QdrantManager.prototype, 'stop').mockResolvedValue();
    vi.spyOn(QdrantManager.prototype, 'start').mockResolvedValue();
    vi.spyOn(ServiceInitializer.prototype, 'initializeServices')
      .mockRejectedValue(initializationFailure);
    const queueStop = vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();

    await expect(new TestBackendRuntimeOwner().start(BACKEND_CONFIGURATION)).rejects.toBe(initializationFailure);
    expect(queueStop).toHaveBeenCalledOnce();
    expect(qdrantStop).toHaveBeenCalledOnce();
  });

  it('启动失败后的资源收口也失败时同时保留两类根因', async () => {
    const initializationFailure = new Error('service initialization failed');
    const cleanupFailure = new Error('qdrant cleanup failed');
    const qdrantStart = vi.spyOn(QdrantManager.prototype, 'start').mockResolvedValue();
    vi.spyOn(QdrantManager.prototype, 'stop').mockRejectedValue(cleanupFailure);
    vi.spyOn(ServiceInitializer.prototype, 'initializeServices')
      .mockRejectedValue(initializationFailure);
    vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();

    const manager = new TestBackendRuntimeOwner();
    await expect(manager.start(BACKEND_CONFIGURATION)).rejects.toMatchObject({
      name: BackendRuntimeStartupError.name,
      startupFailure: initializationFailure,
      cleanupFailure: expect.objectContaining({
        name: BackendRuntimeShutdownError.name,
        failures: [cleanupFailure],
      }),
    });
    await expect(manager.start(BACKEND_CONFIGURATION)).rejects.toThrow('生命周期尚未收口');
    expect(qdrantStart).toHaveBeenCalledOnce();
  });

  it('按 API、命令 owner、Sandbox owner、后台队列顺序停止', async () => {
    const order: string[] = [];
    const manager = new TestBackendRuntimeOwner();
    vi.spyOn(manager.getApiServer(), 'stop').mockImplementation(async () => { order.push('api'); });
    vi.spyOn(QueueManager.getInstance(), 'shutdown').mockImplementation(async () => { order.push('queue'); });
    manager.registerCommandOwnerLifecycle({
      hasExecutingCommands() { return true; },
      async endOwnerAndWait() { order.push('command'); },
    });
    manager.registerSandboxOwnerLifecycle({
      async endOwnerAndWait() { order.push('sandbox'); },
    });

    await manager.stop();
    expect(order).toEqual(['api', 'command', 'sandbox', 'queue']);
    await expect(manager.start(BACKEND_CONFIGURATION)).rejects.toThrow('App 运行时已经结束');
  });

  it('是否有执行中的命令只读取命令 owner，不受 Sandbox owner 影响', () => {
    const manager = new TestBackendRuntimeOwner();
    manager.registerSandboxOwnerLifecycle({
      async endOwnerAndWait() {},
    });

    expect(manager.hasExecutingCommands()).toBe(false);

    manager.registerCommandOwnerLifecycle({
      hasExecutingCommands: () => true,
      async endOwnerAndWait() {},
    });
    expect(manager.hasExecutingCommands()).toBe(true);
  });

  it('并发停止只执行一次 owner 收口链', async () => {
    const manager = new TestBackendRuntimeOwner();
    const apiStop = vi.spyOn(manager.getApiServer(), 'stop').mockResolvedValue();
    const queueStop = vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();
    const ownerStop = vi.fn().mockResolvedValue(undefined);
    const sandboxOwnerStop = vi.fn().mockResolvedValue(undefined);
    manager.registerCommandOwnerLifecycle({
      hasExecutingCommands: () => false,
      endOwnerAndWait: ownerStop,
    });
    manager.registerSandboxOwnerLifecycle({ endOwnerAndWait: sandboxOwnerStop });

    const firstStop = manager.stop();
    const secondStop = manager.stop();
    expect(secondStop).toBe(firstStop);
    await firstStop;

    expect(apiStop).toHaveBeenCalledOnce();
    expect(ownerStop).toHaveBeenCalledOnce();
    expect(sandboxOwnerStop).toHaveBeenCalledOnce();
    expect(queueStop).toHaveBeenCalledOnce();
  });

  it('命令收口失败保留 lifecycle 供再次收口，并传播聚合失败', async () => {
    const manager = new TestBackendRuntimeOwner();
    vi.spyOn(manager.getApiServer(), 'stop').mockResolvedValue();
    vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();
    const cleanupFailure = new Error('owner drain failed');
    const endOwnerAndWait = vi.fn()
      .mockRejectedValueOnce(cleanupFailure)
      .mockResolvedValueOnce(undefined);
    manager.registerCommandOwnerLifecycle({
      hasExecutingCommands: () => true,
      endOwnerAndWait,
    });

    await expect(manager.stop()).rejects.toMatchObject({
      name: BackendRuntimeShutdownError.name,
      failures: [cleanupFailure],
    });
    await expect(manager.stop()).resolves.toBeUndefined();
    expect(endOwnerAndWait).toHaveBeenCalledTimes(2);
  });

  it('命令 owner 失败时继续收口 Sandbox，第二次只重试命令 owner', async () => {
    const manager = new TestBackendRuntimeOwner();
    vi.spyOn(manager.getApiServer(), 'stop').mockResolvedValue();
    vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();
    const commandFailure = new Error('command owner drain failed');
    const commandStop = vi.fn()
      .mockRejectedValueOnce(commandFailure)
      .mockResolvedValueOnce(undefined);
    const sandboxStop = vi.fn().mockResolvedValue(undefined);
    manager.registerCommandOwnerLifecycle({
      hasExecutingCommands: () => false,
      endOwnerAndWait: commandStop,
    });
    manager.registerSandboxOwnerLifecycle({ endOwnerAndWait: sandboxStop });

    await expect(manager.stop()).rejects.toMatchObject({
      name: BackendRuntimeShutdownError.name,
      failures: [commandFailure],
    });
    await expect(manager.stop()).resolves.toBeUndefined();
    expect(commandStop).toHaveBeenCalledTimes(2);
    expect(sandboxStop).toHaveBeenCalledOnce();
  });

  it('Sandbox owner 失败时继续停止后台队列，第二次只重试 Sandbox owner', async () => {
    const manager = new TestBackendRuntimeOwner();
    vi.spyOn(manager.getApiServer(), 'stop').mockResolvedValue();
    const queueStop = vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();
    const commandStop = vi.fn().mockResolvedValue(undefined);
    const sandboxFailure = new Error('sandbox owner drain failed');
    const sandboxStop = vi.fn()
      .mockRejectedValueOnce(sandboxFailure)
      .mockResolvedValueOnce(undefined);
    manager.registerCommandOwnerLifecycle({
      hasExecutingCommands: () => false,
      endOwnerAndWait: commandStop,
    });
    manager.registerSandboxOwnerLifecycle({ endOwnerAndWait: sandboxStop });

    await expect(manager.stop()).rejects.toMatchObject({
      name: BackendRuntimeShutdownError.name,
      failures: [sandboxFailure],
    });
    await expect(manager.stop()).resolves.toBeUndefined();
    expect(commandStop).toHaveBeenCalledOnce();
    expect(sandboxStop).toHaveBeenCalledTimes(2);
    expect(queueStop).toHaveBeenCalledTimes(2);
  });

  it('两个 owner 都失败时按停止顺序保留根因，并在下次停止中分别重试', async () => {
    const manager = new TestBackendRuntimeOwner();
    vi.spyOn(manager.getApiServer(), 'stop').mockResolvedValue();
    vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();
    const commandFailure = new Error('command owner drain failed');
    const sandboxFailure = new Error('sandbox owner drain failed');
    const commandStop = vi.fn()
      .mockRejectedValueOnce(commandFailure)
      .mockResolvedValueOnce(undefined);
    const sandboxStop = vi.fn()
      .mockRejectedValueOnce(sandboxFailure)
      .mockResolvedValueOnce(undefined);
    manager.registerCommandOwnerLifecycle({
      hasExecutingCommands: () => false,
      endOwnerAndWait: commandStop,
    });
    manager.registerSandboxOwnerLifecycle({ endOwnerAndWait: sandboxStop });

    await expect(manager.stop()).rejects.toMatchObject({
      name: BackendRuntimeShutdownError.name,
      failures: [commandFailure, sandboxFailure],
    });
    await expect(manager.stop()).resolves.toBeUndefined();
    expect(commandStop).toHaveBeenCalledTimes(2);
    expect(sandboxStop).toHaveBeenCalledTimes(2);
  });

  it('启用任一 App runtime 后拒绝进程内 restart，且不会先停止现有 backend', async () => {
    const manager = new TestBackendRuntimeOwner();
    const apiStop = vi.spyOn(manager.getApiServer(), 'stop').mockResolvedValue();
    const ownerStop = vi.fn().mockResolvedValue(undefined);
    manager.registerCommandOwnerLifecycle({
      hasExecutingCommands: () => false,
      endOwnerAndWait: ownerStop,
    });
    manager.registerSandboxOwnerLifecycle({
      endOwnerAndWait: vi.fn().mockResolvedValue(undefined),
    });

    await expect(manager.restart(BACKEND_CONFIGURATION)).rejects.toThrow('不支持进程内重启');
    expect(apiStop).not.toHaveBeenCalled();
    expect(ownerStop).not.toHaveBeenCalled();
  });

  it('任一 App owner 经历停止后都不可在当前进程重新启动或注册', async () => {
    const manager = new TestBackendRuntimeOwner();
    vi.spyOn(manager.getApiServer(), 'stop').mockResolvedValue();
    vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();
    const commandLifecycle = {
      hasExecutingCommands: () => false,
      endOwnerAndWait: vi.fn().mockResolvedValue(undefined),
    };
    const sandboxLifecycle = {
      endOwnerAndWait: vi.fn().mockResolvedValue(undefined),
    };
    manager.registerCommandOwnerLifecycle(commandLifecycle);
    manager.registerSandboxOwnerLifecycle(sandboxLifecycle);

    await manager.stop();

    await expect(manager.start(BACKEND_CONFIGURATION)).rejects.toThrow('App 运行时已经结束');
    await expect(manager.restart(BACKEND_CONFIGURATION)).rejects.toThrow('不支持进程内重启');
    expect(() => manager.registerCommandOwnerLifecycle(commandLifecycle)).toThrow('命令运行时已经结束');
    expect(() => manager.registerSandboxOwnerLifecycle(sandboxLifecycle)).toThrow('Sandbox 运行时已经结束');
  });

  it('路由初始化失败已收口两个 scope 时，同时冻结两个 App owner', async () => {
    const manager = new TestBackendRuntimeOwner();
    manager.markConversationRuntimeAppOwnerEnded();

    await expect(manager.start(BACKEND_CONFIGURATION)).rejects.toThrow('App 运行时已经结束');
    await expect(manager.restart(BACKEND_CONFIGURATION)).rejects.toThrow('不支持进程内重启');
    expect(() => manager.registerCommandOwnerLifecycle({
      hasExecutingCommands: () => false,
      async endOwnerAndWait() {},
    })).toThrow('命令运行时已经结束');
    expect(() => manager.registerSandboxOwnerLifecycle({
      async endOwnerAndWait() {},
    })).toThrow('Sandbox 运行时已经结束');
  });

  it('并发退出共享同一个后端收口任务，停止期间拒绝重新启动', async () => {
    const manager = new TestBackendRuntimeOwner();
    const apiStop = vi.spyOn(manager.getApiServer(), 'stop').mockImplementation(async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
    });
    const ownerStop = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();
    manager.registerCommandOwnerLifecycle({
      hasExecutingCommands: () => true,
      endOwnerAndWait: ownerStop,
    });

    const firstStop = manager.stop();
    const secondStop = manager.stop();

    expect(secondStop).toBe(firstStop);
    await expect(manager.start(BACKEND_CONFIGURATION)).rejects.toThrow('正在停止');
    await expect(firstStop).resolves.toBeUndefined();
    expect(apiStop).toHaveBeenCalledOnce();
    expect(ownerStop).toHaveBeenCalledOnce();
  });
});
