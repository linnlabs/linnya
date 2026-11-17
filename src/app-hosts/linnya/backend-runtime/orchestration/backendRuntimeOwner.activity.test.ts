import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../../electron-main/services/apiServer', () => ({
  ApiServer: class TestApiServer {
    setupMiddleware(): void {}
    async start(port: number): Promise<number> {
      return port;
    }
    async stop(): Promise<void> {}
    getToken(): string {
      return 'test-token';
    }
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
    getConfig(): Record<string, never> {
      return {};
    }
  },
}));

import {
  syncBackendPluginRuntimeEffects,
  clearSyncedBackendPluginRuntimeEffectsForTests,
} from '../../plugin-registry/runtimeEffectRuntime';
import { QueueManager } from '../../../../infra/task-queue/queues';
import type { ForegroundAgentRunActivityPort } from '../../adapters/flow/interactive-run/orchestration/foregroundAgentRunActivity';
import { BackendRuntimeOwner } from './backendRuntimeOwner';

const BACKEND_CONFIGURATION = Object.freeze({
  qdrant: Object.freeze({ host: '127.0.0.1', port: 6333 }),
  server: Object.freeze({ port: 34000 }),
});

class TestBackendRuntimeOwner extends BackendRuntimeOwner {
  constructor() {
    super(
      {
        binaryPath: '/test/runtime/qdrant',
        platform: 'darwin',
        environment: Object.freeze({}),
      },
      async () => {
        throw new Error('test Qdrant process owner must not launch');
      },
      Object.freeze({
        audioProcessingScriptPath: '/test/runtime/audio-processing.worker.cjs',
        pluginBootstrapScriptPath: '/test/runtime/plugin-runtime.worker.cjs',
      }),
      Object.freeze({
        developmentRoot: '/workspace/linnya',
        appDataRoot: '/workspace/linnya/_dev_data',
        workspaceRoot: '/workspace/linnya/_dev_data',
        workspaceRootIsCustom: false,
      }),
      '0.0.38'
    );
  }
}

function createActivity(): ForegroundAgentRunActivityPort {
  return {
    listActive: vi.fn(async () => [
      { conversationId: 'conversation-a', conversationTitle: '周报' },
    ]),
    pauseAll: vi.fn(async () => ({
      pausedConversationIds: ['conversation-a'],
      unpausableConversationIds: [],
    })),
  };
}

afterEach(async () => {
  await clearSyncedBackendPluginRuntimeEffectsForTests();
  vi.restoreAllMocks();
});

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

  it('Backend 只聚合正式插件活动和独立 Audio，停止后不再报告旧 owner', async () => {
    const queue = QueueManager.getInstance();
    const audioActive = vi.spyOn(queue, 'hasActiveTasks').mockReturnValue(false);
    vi.spyOn(queue, 'shutdown').mockResolvedValue();
    let pluginActive = false;
    const hasActiveWork = vi.fn(() => pluginActive);
    const deactivate = vi.fn();
    const owner = new TestBackendRuntimeOwner();
    expect(owner.hasActiveKnowledgeIngestion()).toBe(false);
    expect(audioActive).not.toHaveBeenCalled();
    await owner.start(BACKEND_CONFIGURATION);
    await syncBackendPluginRuntimeEffects([
      {
        pluginId: 'fixture',
        effect: { id: 'tasks', activate() {}, deactivate, hasActiveWork },
      },
    ]);
    expect(owner.hasActiveKnowledgeIngestion()).toBe(false);
    pluginActive = true;
    expect(owner.hasActiveKnowledgeIngestion()).toBe(true);
    pluginActive = false;
    audioActive.mockReturnValue(true);
    expect(owner.hasActiveKnowledgeIngestion()).toBe(true);
    audioActive.mockReturnValue(false);
    expect(owner.hasActiveKnowledgeIngestion()).toBe(false);
    owner.registerAgentRunActivity(createActivity());
    await owner.stop();
    expect(deactivate).toHaveBeenCalledOnce();
    expect(owner.hasActiveKnowledgeIngestion()).toBe(false);
    await expect(owner.listActiveAgentRuns()).resolves.toEqual([]);
  });
});
