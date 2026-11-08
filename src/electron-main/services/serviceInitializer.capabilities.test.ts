import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const graphConstruction = vi.hoisted(() => vi.fn<() => void>());

// 启动清理、插件运行资源与知识库实现都会读写本机数据目录或拉起 Worker；本组全部替换，
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
vi.mock('src/features/knowledge-base/index', () => ({
  KnowledgeBaseService: class {},
  KnowledgeBaseCoordinator: class {},
  DefaultSearchService: class {},
}));
vi.mock('src/features/knowledge-base/graph/application/knowledgeGraphQueueOrchestrator', () => ({
  KnowledgeGraphQueueOrchestrator: class {
    constructor() { graphConstruction(); }
    start() {}
  },
}));

import * as databaseModule from './database';
import { DatabaseService } from './database';
import { ServiceInitializer } from './serviceInitializer';
import { scheduleStartupMaintenanceOnce } from './startup/startupMaintenanceRunner';
import { syncRegisteredBackendPluginRuntimeResources } from '../../app-hosts/linnya/plugin-registry/builtin';
import * as rendererIntegration from '../../app-hosts/linnya/desktop-capabilities';
import { installDistributionIdentity } from '../../shared/distribution-identity';
import { QueueManager } from '../../infra/task-queue/queues';
import { IngestionJobPayloadSchema } from '../../infra/task-queue/jobs';
import { DEFAULT_CONFIG } from '../../features/transcription/audio-preprocessing/config';

class TestQueueOwner extends QueueManager {
  constructor() { super(); }
}

type StepName =
  | 'initializeDatabaseService'
  | 'initializeModelCatalog'
  | 'initializeAdapters'
  | 'initializeKnowledgeBaseService'
  | 'initializeQueueSystem';

const KNOWLEDGE_BASE = Object.freeze({ kind: 'test-knowledge-base' });
const KNOWLEDGE_BASE_MAINTENANCE = Object.freeze({ kind: 'test-knowledge-base-maintenance' });

let root: string;
let database: DatabaseService;
let disposeModelCatalogUpdates: ReturnType<typeof vi.fn>;

function stubStep(name: StepName, implementation: () => Promise<unknown>) {
  // 私有步骤是本组要替换的边界；按名字替换，不改变生产类型。
  return vi.spyOn(
    ServiceInitializer.prototype as unknown as Record<StepName, () => Promise<unknown>>,
    name,
  ).mockImplementation(implementation);
}

function createInitializer(): ServiceInitializer {
  return new ServiceInitializer(
    Object.freeze({
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
    '0.0.38',
  );
}

beforeEach(() => {
  graphConstruction.mockReset();
  root = mkdtempSync(path.join(tmpdir(), 'linnya-service-capabilities-'));
  database = new DatabaseService(path.join(root, 'workspace.sqlite'));
  database.initialize();
  disposeModelCatalogUpdates = vi.fn();
  stubStep('initializeDatabaseService', async () => database);
  stubStep('initializeModelCatalog', async () => disposeModelCatalogUpdates);
  stubStep('initializeAdapters', async () => ({}));
  stubStep('initializeKnowledgeBaseService', async () => ({
    service: KNOWLEDGE_BASE,
    maintenance: KNOWLEDGE_BASE_MAINTENANCE,
  }));
  stubStep('initializeQueueSystem', async () => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(scheduleStartupMaintenanceOnce).mockClear();
  database.close();
  rmSync(root, { recursive: true, force: true });
});

const READY = Object.freeze({ kind: 'ready', url: 'http://127.0.0.1:6333' } as const);

describe('服务初始化：能力步骤失败只停掉这项能力', () => {
  it('全部成功时没有能力失败，维护任务带上知识库', async () => {
    const services = await createInitializer().initializeServices({}, READY);
    expect(services.capabilityFailures).toEqual([]);
    expect(services.knowledgeBaseService).toBe(KNOWLEDGE_BASE);
    expect(scheduleStartupMaintenanceOnce).toHaveBeenCalledWith({
      databaseService: database,
      knowledgeBase: KNOWLEDGE_BASE_MAINTENANCE,
    });
    services.disposeRendererIntegration();
    expect(disposeModelCatalogUpdates).toHaveBeenCalledOnce();
  });

  it('模型配置加载失败：照常完成，记下原因，其余能力不受影响', async () => {
    stubStep('initializeModelCatalog', async () => {
      throw new Error('user_models.json 无法读取：Unexpected end of JSON input');
    });
    const services = await createInitializer().initializeServices({}, READY);
    expect(services.capabilityFailures).toEqual([{
      capability: 'models',
      message: '模型配置没有加载成功（user_models.json 无法读取：Unexpected end of JSON input）',
    }]);
    expect(services.knowledgeBaseService).toBe(KNOWLEDGE_BASE);
    expect(() => services.disposeRendererIntegration()).not.toThrow();
  });

  it('向量库没有启动：跳过知识库整组，不连默认地址；Workspace 与会话维护照常调度', async () => {
    const adapters = stubStep('initializeAdapters', async () => ({}));
    const services = await createInitializer().initializeServices({}, {
      kind: 'unavailable',
      message: '向量库没有启动成功（spawn qdrant ENOENT）',
    });
    expect(adapters).not.toHaveBeenCalled();
    expect(services.knowledgeBaseService).toBeNull();
    expect(services.capabilityFailures).toEqual([{
      capability: 'knowledge-base',
      message: '向量库没有启动成功（spawn qdrant ENOENT）',
    }]);
    expect(scheduleStartupMaintenanceOnce).toHaveBeenCalledWith({
      databaseService: database,
      knowledgeBase: null,
    });
  });

  it('知识库服务装配失败：知识库为空，记下原因', async () => {
    stubStep('initializeKnowledgeBaseService', async () => {
      throw Object.assign(new Error('permission denied, mkdir SourceOfTruth'), { code: 'EACCES' });
    });
    const services = await createInitializer().initializeServices({}, READY);
    expect(services.knowledgeBaseService).toBeNull();
    expect(services.capabilityFailures).toEqual([{
      capability: 'knowledge-base',
      message: '知识库服务没有启动成功（permission denied, mkdir SourceOfTruth）',
    }]);
    expect(scheduleStartupMaintenanceOnce).toHaveBeenCalledWith({
      databaseService: database,
      knowledgeBase: null,
    });
  });

  it('任务队列没有启动：知识库服务仍可读，记下原因', async () => {
    stubStep('initializeQueueSystem', async () => {
      throw new Error('worker script missing');
    });
    const services = await createInitializer().initializeServices({}, READY);
    expect(services.knowledgeBaseService).toBe(KNOWLEDGE_BASE);
    expect(services.capabilityFailures).toEqual([{
      capability: 'background-tasks',
      message: '后台任务队列没有启动成功（worker script missing）',
    }]);
  });

  it('队列已建好但图谱装配失败：先回收队列，再降级继续启动，不能继续接任务', async () => {
    // 保留真实队列生命周期，只替换图谱故障与宿主发布端口；不启动 Worker 或访问用户数据。
    stubStep('initializeQueueSystem', async () => undefined).mockRestore();
    const queue = new TestQueueOwner();
    vi.spyOn(QueueManager, 'getInstance').mockReturnValue(queue);
    vi.spyOn(databaseModule, 'getDatabaseService').mockReturnValue(database);
    installDistributionIdentity({ kind: 'source', packaged: false });
    vi.spyOn(rendererIntegration, 'getBackendRendererIntegrationPort').mockReturnValue({
      connectModelCatalogUpdates: async () => () => undefined,
      publishIngestionStatus: vi.fn(),
      queueJobPresentationPublisher: {
        publishProgress: vi.fn(), publishCompletion: vi.fn(), publishFailure: vi.fn(),
      },
      publishKnowledgeGraphProgress: vi.fn(),
      publishTranscriptionProgress: vi.fn(),
      publishWorkspaceMutation: vi.fn(),
      publishPluginRendererPush: vi.fn(),
      publishTodosChanged: vi.fn(),
      publishPluginsChanged: vi.fn(),
      publishModelsChanged: vi.fn(),
    });
    const reason = 'EACCES: source_of_truth unavailable';
    graphConstruction.mockImplementationOnce(() => {
      // 故障发生在 QueueManager.initialize 完成之后，而非队列内部初始化阶段。
      expect(queue.getQueueStats()).toMatchObject({ pending: 0, running: 0 });
      throw new Error(reason);
    });

    try {
      const services = await createInitializer().initializeServices({}, READY);
      expect(graphConstruction).toHaveBeenCalledOnce();
      expect(services.capabilityFailures).toEqual([{
        capability: 'background-tasks',
        message: expect.stringContaining(reason),
      }]);
      expect(services.knowledgeBaseService).toBe(KNOWLEDGE_BASE);
      expect(services.databaseService.getDb().prepare('SELECT 1 AS value').get()).toEqual({ value: 1 });
      expect(() => queue.getQueueStats()).toThrow('队列管理器未初始化');
      await expect(queue.addIngestionTask(IngestionJobPayloadSchema.parse({
        taskId: 'ingestion', kbId: 'kb', docId: 'doc', embeddingModelId: 'embedding',
        filename: 'doc.txt', filePath: path.join(root, 'doc.txt'),
      }))).rejects.toThrow('摄入队列未初始化');
      expect(() => queue.processAudio(path.join(root, 'audio.wav'), DEFAULT_CONFIG))
        .toThrow('音频处理队列未初始化');
    } finally {
      await queue.shutdown();
    }
  });

  it('几项能力同时失败时逐项记录', async () => {
    stubStep('initializeModelCatalog', async () => { throw new Error('a'); });
    stubStep('initializeQueueSystem', async () => { throw new Error('b'); });
    const services = await createInitializer().initializeServices({}, {
      kind: 'unavailable',
      message: '向量库没有启动成功（c）',
    });
    expect(services.capabilityFailures.map(failure => failure.capability)).toEqual([
      'models',
      'knowledge-base',
      'background-tasks',
    ]);
  });
});

describe('服务初始化：必需步骤失败仍然挡启动', () => {
  it('数据库打开失败直接抛出，不调度维护', async () => {
    const failure = Object.assign(new Error('file is not a database'), { code: 'SQLITE_NOTADB' });
    stubStep('initializeDatabaseService', async () => { throw failure; });
    await expect(createInitializer().initializeServices({}, READY)).rejects.toBe(failure);
    expect(scheduleStartupMaintenanceOnce).not.toHaveBeenCalled();
  });

  it('插件运行资源同步失败直接抛出：路由注册依赖同一份注册表，跳过没有意义', async () => {
    const failure = new Error('plugin registration incomplete');
    vi.mocked(syncRegisteredBackendPluginRuntimeResources).mockRejectedValueOnce(failure);
    await expect(createInitializer().initializeServices({}, READY)).rejects.toBe(failure);
  });
});
