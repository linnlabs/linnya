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
    async stopStartupMaintenance(): Promise<void> {}
    async initializeServices(): Promise<never> {
      throw new Error('initializeServices test implementation is required');
    }
  },
}));

vi.mock('../../../../electron-main/services/qdrantManager', () => ({
  QdrantManager: class TestQdrantManager {
    async start(): Promise<void> {}
    async stop(): Promise<void> {}
    getConfig() { return { host: '127.0.0.1', port: 6333, url: 'http://127.0.0.1:6333' }; }
  },
}));

import { QueueManager } from '../../../../infra/task-queue/queues';
import { QdrantManager } from '../../../../electron-main/services/qdrantManager';
import { ServiceInitializer } from '../../../../electron-main/services/serviceInitializer';
import type { StartupCapabilityFailure } from '../../../../electron-main/services/startup/startupCapabilityFailure';
import { BackendRuntimeOwner } from './backendRuntimeOwner';

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

function initializedServices(capabilityFailures: readonly StartupCapabilityFailure[]): never {
  // 只用到 capabilityFailures 与 disposeRendererIntegration；其余服务本组不读取。
  return Object.freeze({ capabilityFailures, disposeRendererIntegration() {} }) as never;
}

afterEach(() => vi.restoreAllMocks());

describe('BackendRuntimeOwner 能力降级', () => {
  it('Qdrant 没有启动：收口已拉起的进程，知识库整组跳过，Backend 照常启动并记下原因', async () => {
    vi.spyOn(QdrantManager.prototype, 'start').mockRejectedValue(new Error('spawn qdrant ENOENT'));
    const qdrantStop = vi.spyOn(QdrantManager.prototype, 'stop').mockResolvedValue();
    const initialize = vi.spyOn(ServiceInitializer.prototype, 'initializeServices')
      .mockImplementation(async (_config, vectorStore) => initializedServices(
        vectorStore.kind === 'unavailable'
          ? [{ capability: 'knowledge-base', message: vectorStore.message }]
          : [],
      ));
    const manager = new TestBackendRuntimeOwner();

    await expect(manager.start(BACKEND_CONFIGURATION)).resolves.toBe(34000);

    expect(initialize).toHaveBeenCalledWith({}, {
      kind: 'unavailable',
      message: '向量库没有启动成功（spawn qdrant ENOENT）',
    });
    expect(qdrantStop).toHaveBeenCalledOnce();
    expect(manager.getStartupCapabilityFailure('knowledge-base')).toEqual({
      capability: 'knowledge-base',
      message: '向量库没有启动成功（spawn qdrant ENOENT）',
    });
    expect(manager.getStartupCapabilityFailure('models')).toBeNull();

    // Qdrant 已经收口，正式停止不再重复停止它。
    vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();
    await manager.stop();
    expect(qdrantStop).toHaveBeenCalledOnce();
  });

  it('Qdrant 正常时把实际地址交给服务初始化', async () => {
    const initialize = vi.spyOn(ServiceInitializer.prototype, 'initializeServices')
      .mockResolvedValue(initializedServices([]));
    const manager = new TestBackendRuntimeOwner();
    await manager.start(BACKEND_CONFIGURATION);
    expect(initialize).toHaveBeenCalledWith({}, { kind: 'ready', url: 'http://127.0.0.1:6333' });
    expect(manager.getStartupCapabilityFailures()).toEqual([]);
    vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();
    await manager.stop();
  });

  it('任务队列没有启动时，退出前查询导入任务直接返回没有，不去读未启动的队列', async () => {
    vi.spyOn(ServiceInitializer.prototype, 'initializeServices').mockResolvedValue(
      initializedServices([{ capability: 'background-tasks', message: '后台任务队列没有启动成功' }]),
    );
    const stats = vi.spyOn(QueueManager.getInstance(), 'getQueueStats');
    const manager = new TestBackendRuntimeOwner();
    await manager.start(BACKEND_CONFIGURATION);

    expect(manager.hasActiveKnowledgeIngestion()).toBe(false);
    expect(stats).not.toHaveBeenCalled();
    vi.spyOn(QueueManager.getInstance(), 'shutdown').mockResolvedValue();
    await manager.stop();
  });
});
