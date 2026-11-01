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
    async initializeServices() {
      return { disposeRendererIntegration() {} };
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
import type { ForegroundAgentRunActivityPort } from '../../adapters/flow/interactive-run/orchestration/foregroundAgentRunActivity';
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

function createActivity(): ForegroundAgentRunActivityPort {
  return {
    listActive: vi.fn(async () => [{ conversationId: 'conversation-a', conversationTitle: '周报' }]),
    pauseAll: vi.fn(async () => ({
      pausedConversationIds: ['conversation-a'],
      unpausableConversationIds: [],
    })),
  };
}

afterEach(() => vi.restoreAllMocks());

describe('BackendRuntimeOwner activity source', () => {
  it('Agent runtime 注册前返回空 run 列表与空暂停结果', async () => {
    const owner = new TestBackendRuntimeOwner();

    await expect(owner.listActiveAgentRuns()).resolves.toEqual([]);
    await expect(owner.pauseActiveAgentRuns()).resolves.toEqual({
      pausedConversationIds: [],
      unpausableConversationIds: [],
    });
  });

  it('注册后委托给唯一 Agent run 活动端口，并拒绝第二套端口', async () => {
    const owner = new TestBackendRuntimeOwner();
    const activity = createActivity();
    owner.registerAgentRunActivity(activity);
    owner.registerAgentRunActivity(activity);

    await expect(owner.listActiveAgentRuns()).resolves.toEqual([
      { conversationId: 'conversation-a', conversationTitle: '周报' },
    ]);
    await expect(owner.pauseActiveAgentRuns()).resolves.toEqual({
      pausedConversationIds: ['conversation-a'],
      unpausableConversationIds: [],
    });
    expect(() => owner.registerAgentRunActivity(createActivity())).toThrow('另一套 Agent run');
  });

  it('知识库摄入只在 Backend 运行期间读取队列待处理与执行中任务', async () => {
    const queue = QueueManager.getInstance();
    const stats = vi.spyOn(queue, 'getQueueStats').mockReturnValue({
      total: 3,
      pending: 0,
      running: 0,
      completed: 2,
      failed: 1,
    });
    vi.spyOn(queue, 'shutdown').mockResolvedValue();
    const owner = new TestBackendRuntimeOwner();

    expect(owner.hasActiveKnowledgeIngestion()).toBe(false);
    expect(stats).not.toHaveBeenCalled();

    await owner.start(BACKEND_CONFIGURATION);
    expect(owner.hasActiveKnowledgeIngestion()).toBe(false);
    stats.mockReturnValue({ total: 1, pending: 1, running: 0, completed: 0, failed: 0 });
    expect(owner.hasActiveKnowledgeIngestion()).toBe(true);
    stats.mockReturnValue({ total: 1, pending: 0, running: 1, completed: 0, failed: 0 });
    expect(owner.hasActiveKnowledgeIngestion()).toBe(true);

    owner.registerAgentRunActivity(createActivity());
    await owner.stop();
    expect(owner.hasActiveKnowledgeIngestion()).toBe(false);
    // 收口后不再报告或暂停已释放 Flow 的 run。
    await expect(owner.listActiveAgentRuns()).resolves.toEqual([]);
  });
});
