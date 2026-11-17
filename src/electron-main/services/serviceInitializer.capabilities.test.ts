import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// 项目只读口是独立的 Host owner；本组数据库注入不初始化应用级单例。
vi.mock('src/plugin-sdk/backend/projectReadRuntime', () => ({
  getPluginProjectReadPort: () => ({ get: () => undefined }),
}));

// 启动清理与插件运行资源可能读写本机数据目录或拉起 Worker；本组替换这两个装配边界，
// 只用临时目录里的真实数据库。
vi.mock('./startup/startupMaintenanceRunner', () => ({
  runManagedImageStartupMaintenance: vi.fn(async () => undefined),
  runCommandOutputArtifactStartupMaintenance: vi.fn(async () => undefined),
  runToolOutputStoreStartupMaintenance: vi.fn(async () => undefined),
  scheduleStartupMaintenanceOnce: vi.fn(() => ({ stop: async () => undefined })),
}));
vi.mock('../../app-hosts/linnya/plugin-registry/builtin', () => ({
  bootstrapBuiltinPluginLifecycle: vi.fn(),
  syncRegisteredBackendPluginRuntimeResources: vi.fn(async () => undefined),
}));
vi.mock('../../app-hosts/linnya/plugin-registry/pluginRuntimeState', () => ({
  setPluginRuntimeDatabase: vi.fn(),
}));
import { DatabaseService } from './database';
import { ServiceInitializer } from './serviceInitializer';
import { scheduleStartupMaintenanceOnce } from './startup/startupMaintenanceRunner';
import { syncRegisteredBackendPluginRuntimeResources } from '../../app-hosts/linnya/plugin-registry/builtin';
import { QueueManager } from '../../infra/task-queue/queues';
import { AudioProcessingQueue } from '../../infra/task-queue/AudioProcessingQueue';
import { DEFAULT_CONFIG } from '../../features/transcription/audio-preprocessing/config';

class TestQueueOwner extends QueueManager {
  constructor() {
    super();
  }
}

type StepName = 'initializeDatabaseService' | 'initializeModelCatalog' | 'initializeQueueSystem';

let root: string;
let database: DatabaseService;
let disposeModelCatalogUpdates: ReturnType<typeof vi.fn>;

function stubStep(name: StepName, implementation: () => Promise<unknown>) {
  // 私有步骤是本组要替换的边界；按名字替换，不改变生产类型。
  return vi
    .spyOn(
      ServiceInitializer.prototype as unknown as Record<StepName, () => Promise<unknown>>,
      name
    )
    .mockImplementation(implementation);
}

function createInitializer(): ServiceInitializer {
  return new ServiceInitializer(
    Object.freeze({
      pluginBootstrapScriptPath: '/test/plugin-runtime.cjs',
      ingestionScriptPath: '/test/ingestion.cjs',
      audioProcessingScriptPath: '/test/audio.cjs',
      graphExtractionScriptPath: '/test/graph-extraction.cjs',
      graphIndexingScriptPath: '/test/graph-indexing.cjs',
    }),
    Object.freeze({
      developmentRoot: root,
      appDataRoot: root,
      workspaceRoot: root,
      workspaceRootIsCustom: false,
    }),
    '0.0.38'
  );
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'linnya-service-capabilities-'));
  database = new DatabaseService(path.join(root, 'workspace.sqlite'));
  database.initialize();
  disposeModelCatalogUpdates = vi.fn();
  stubStep('initializeDatabaseService', async () => database);
  stubStep('initializeModelCatalog', async () => disposeModelCatalogUpdates);
  stubStep('initializeQueueSystem', async () => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(scheduleStartupMaintenanceOnce).mockClear();
  database.close();
  rmSync(root, { recursive: true, force: true });
});

describe('服务初始化：能力步骤失败只停掉这项能力', () => {
  it('全部成功时没有能力失败，启动维护只装配 Host 数据库', async () => {
    const services = await createInitializer().initializeServices();
    expect(services.capabilityFailures).toEqual([]);
    expect(scheduleStartupMaintenanceOnce).toHaveBeenCalledWith({
      databaseService: database,
    });
    services.disposeRendererIntegration();
    expect(disposeModelCatalogUpdates).toHaveBeenCalledOnce();
  });

  it('模型配置加载失败：照常完成，记下原因，其余能力不受影响', async () => {
    stubStep('initializeModelCatalog', async () => {
      throw new Error('user_models.json 无法读取：Unexpected end of JSON input');
    });
    const services = await createInitializer().initializeServices();
    expect(services.capabilityFailures).toEqual([
      {
        capability: 'models',
        message: '模型配置没有加载成功（user_models.json 无法读取：Unexpected end of JSON input）',
      },
    ]);
    expect(() => services.disposeRendererIntegration()).not.toThrow();
  });

  it('音频队列没有启动：数据库和插件已装配，记下原因', async () => {
    stubStep('initializeQueueSystem', async () => {
      throw new Error('worker script missing');
    });
    const services = await createInitializer().initializeServices();
    expect(services.capabilityFailures).toEqual([
      {
        capability: 'background-tasks',
        message: '后台任务队列没有启动成功（worker script missing）',
      },
    ]);
  });

  it('音频初始化失败先回收自身资源，插件装配与数据库仍然可用', async () => {
    stubStep('initializeQueueSystem', async () => undefined).mockRestore();
    const queue = new TestQueueOwner();
    vi.spyOn(QueueManager, 'getInstance').mockReturnValue(queue);
    const failure = new Error('audio worker unavailable');
    vi.spyOn(AudioProcessingQueue.prototype, 'initialize').mockRejectedValue(failure);
    const shutdown = vi.spyOn(AudioProcessingQueue.prototype, 'shutdown').mockResolvedValue();
    try {
      const services = await createInitializer().initializeServices();
      expect(shutdown).toHaveBeenCalledOnce();
      expect(syncRegisteredBackendPluginRuntimeResources).toHaveBeenCalled();
      expect(services.databaseService.getDb().prepare('SELECT 1 AS value').get()).toEqual({
        value: 1,
      });
      expect(services.capabilityFailures).toEqual([
        {
          capability: 'background-tasks',
          message: expect.stringContaining(failure.message),
        },
      ]);
      expect(() => queue.processAudio(path.join(root, 'audio.wav'), DEFAULT_CONFIG)).toThrow(
        failure.message
      );
    } finally {
      await queue.shutdown();
    }
  });

  it('几项能力同时失败时逐项记录', async () => {
    stubStep('initializeModelCatalog', async () => {
      throw new Error('a');
    });
    stubStep('initializeQueueSystem', async () => {
      throw new Error('b');
    });
    const services = await createInitializer().initializeServices();
    expect(services.capabilityFailures.map(failure => failure.capability)).toEqual([
      'models',
      'background-tasks',
    ]);
  });
});

describe('服务初始化：必需步骤失败仍然挡启动', () => {
  it('数据库打开失败直接抛出，不调度维护', async () => {
    const failure = Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
    stubStep('initializeDatabaseService', async () => {
      throw failure;
    });
    await expect(createInitializer().initializeServices()).rejects.toBe(failure);
    expect(scheduleStartupMaintenanceOnce).not.toHaveBeenCalled();
  });

  it('插件运行资源同步失败直接抛出：路由注册依赖同一份注册表，跳过没有意义', async () => {
    const failure = new Error('plugin registration incomplete');
    vi.mocked(syncRegisteredBackendPluginRuntimeResources).mockRejectedValueOnce(failure);
    await expect(createInitializer().initializeServices()).rejects.toBe(failure);
  });
});
