/**
 * @file src/electron-main/services/serviceInitializer.ts
 *
 * @brief 服务初始化器 - 负责创建和配置所有应用服务
 *
 * @description
 * 功能：封装复杂的服务初始化逻辑，管理服务依赖关系
 * 输入：配置对象和Qdrant配置
 * 输出：初始化完成的服务实例集合
 * 副作用：注册服务到ServiceRegistry，执行启动清理
 */

import { ServiceRegistry } from '@core/di/ServiceRegistry';
import { randomUUID } from 'node:crypto';
import {
  KnowledgeBaseService,
  KnowledgeBaseCoordinator,
  DefaultSearchService,
} from 'src/features/knowledge-base/index';
import { BetterSqliteMetadataRepository } from 'src/features/knowledge-base/infrastructure/sqlite/better-sqlite-metadata.repository';
import { ProjectKnowledgeBaseLinksService } from 'src/features/knowledge-base/infrastructure/sqlite/project-knowledge-base-links.service';
import { FileSotRepository } from 'src/features/knowledge-base/infrastructure/sotRepository';
import { FileOriginalDocumentRepository } from 'src/features/knowledge-base/infrastructure/fileOriginalDocumentRepository';
import { QdrantRepositoryImpl } from 'src/features/knowledge-base/infrastructure/QdrantRepositoryImpl';
import { BetterSqliteKnowledgeGraphRepository } from 'src/features/knowledge-base/graph/infrastructure/better-sqlite-knowledge-graph.repository';
import { TranscriptionService } from '@transcription/index';
// AgentService 已移除，使用新架构
import { pathManager } from '../../shared/utils/pathManager';
import { QdrantAdapter, type QdrantConfig } from 'src/infra/adapters/vector-store/qdrant/index';
import {
  runManagedImageStartupMaintenance,
  runCommandOutputArtifactStartupMaintenance,
  runToolOutputStoreStartupMaintenance,
  scheduleStartupMaintenanceOnce,
} from './startup/startupMaintenanceRunner';
import { QueueManager } from 'src/infra/task-queue/queues';
import { modelCatalog } from 'src/domains/model-catalog';
import { providerCatalog } from '@linnya/provider-catalog';
import { providerConfigurationRegistry } from 'src/domains/provider-configuration';
import { modelPickerPreferencesRegistry } from 'src/domains/model-picker-preferences';
import { providerAccountRegistry } from 'src/domains/provider-account';
import {
  getBackendRendererIntegrationPort,
  getDesktopCredentialProtectionPort,
} from 'src/app-hosts/linnya/desktop-capabilities';
import { providerOnboardingRuntimeBindingRegistry } from 'src/app-hosts/linnya/adapters/inference';
import { runProviderConfigurationMigration } from 'src/app-hosts/linnya/application/provider-configuration-migration';
import { getDatabaseService, DatabaseService } from './database'; // 导入 DatabaseService
import { KnowledgeGraphQueueOrchestrator } from 'src/features/knowledge-base/graph/application/knowledgeGraphQueueOrchestrator';
import { setPluginRuntimeDatabase } from '../../app-hosts/linnya/plugin-registry/pluginRuntimeState';
import {
  bootstrapBuiltinPluginLifecycle,
  syncRegisteredBackendPluginRuntimeResources,
} from '../../app-hosts/linnya/plugin-registry/builtin';
import {
  syncCompletionToIngestionStore,
  syncProgressToIngestionStore,
} from '../../features/knowledge-base/ingestion/orchestration/workerIngestionProgressProjection';
import {
  createDefaultHostInferencePort,
  createEmbeddingPort,
  createRerankingPort,
  createTextGenerationPort,
} from 'src/app-hosts/linnya/adapters/inference';
import { createDocumentOcrPort } from 'src/app-hosts/linnya/adapters/document-ocr';
import type { DocumentOcrPort } from 'src/domains/document-ocr';
import type { QueueWorkerRuntime } from 'src/infra/task-queue/definitions/queueWorkerRuntime';
import type { RuntimePathRoots } from 'src/shared/runtime-paths';
import { requireInstalledDistributionIdentity } from 'src/shared/distribution-identity';

/**
 * 服务初始化结果接口
 */
export interface InitializedServices {
  knowledgeBaseService: KnowledgeBaseService;
  projectKnowledgeBaseLinksService: ProjectKnowledgeBaseLinksService; // +++ 添加
  transcriptionService: TranscriptionService;
  databaseService: DatabaseService; // +++ 添加
  documentOcr: DocumentOcrPort;
  disposeRendererIntegration(): void;
  // agentService 已移除
  // chatService 已移除，使用新的统一架构
}

/**
 * 服务初始化配置接口
 */
export interface ServiceInitializationConfig {
  qdrant?: {
    url?: string;
    apiKey?: string;
    timeout?: number;
  };
}

/**
 * 服务初始化器类
 */
export class ServiceInitializer {
  private serviceRegistry: ServiceRegistry;
  private qdrantUrl: string | null = null;

  constructor(
    private readonly queueWorkerRuntime: QueueWorkerRuntime,
    private readonly runtimePathRoots: RuntimePathRoots,
    private readonly applicationVersion: string,
  ) {
    this.serviceRegistry = ServiceRegistry.getInstance();
  }

  /**
   * 初始化所有应用服务
   *
   * @param config 服务配置
   * @param qdrantManagerConfig Qdrant管理器配置
   * @returns 初始化完成的服务实例
   */
  public async initializeServices(
    config: ServiceInitializationConfig,
    qdrantManagerConfig?: { url?: string }
  ): Promise<InitializedServices> {
    console.log('[🔥 SERVICE-INIT] ===== initializeServices() METHOD CALLED =====');
    console.log('[ServiceInitializer] 🔧 开始详细的服务初始化...');

    let disposeRendererIntegration: (() => void) | null = null;
    try {
      // 步骤1：初始化数据库服务
      const databaseService = await this.initializeDatabaseService();
      // 内容寻址文件 GC 必须在路由和 Agent ingress 开放前结束，否则旧孤儿回收
      // 可能删除本进程刚重新登记或尚未发布 manifest 的文件。
      await runManagedImageStartupMaintenance({ databaseService });
      await runCommandOutputArtifactStartupMaintenance();
      await runToolOutputStoreStartupMaintenance();
      setPluginRuntimeDatabase(databaseService.getDb());
      await syncRegisteredBackendPluginRuntimeResources();
      console.log('[🔥 SERVICE-INIT] initializeDatabaseService() completed.');

      // 步骤2：准备环境变量
      await this.prepareEnvironmentVariables();

      // 步骤3：初始化产品模型目录
      disposeRendererIntegration = await this.initializeModelCatalog(config);

      // 步骤4：初始化适配器
      const qdrantAdapterInstance = await this.initializeAdapters(config, qdrantManagerConfig);

      // 步骤5：装配独立推理能力窄端口
      const embedding = createEmbeddingPort();
      const reranking = createRerankingPort();
      const documentOcr = createDocumentOcrPort({ catalog: modelCatalog });

      // 步骤6：初始化知识库服务
      const knowledgeBaseService = await this.initializeKnowledgeBaseService(
        qdrantAdapterInstance,
        embedding,
        reranking,
        documentOcr
      );

      // 步骤6.5：初始化项目-知识库关联服务
      const projectKnowledgeBaseLinksService =
        await this.initializeProjectKnowledgeBaseLinksService(databaseService);

      // 步骤7：初始化转录服务
      const transcriptionService = await this.initializeTranscriptionService();

      // 步骤8：初始化队列系统
      await this.initializeQueueSystem();

      console.log('[ServiceInitializer] ✨ 所有服务初始化成功!');

      return {
        knowledgeBaseService,
        projectKnowledgeBaseLinksService,
        transcriptionService,
        databaseService, // +++ 添加
        documentOcr,
        disposeRendererIntegration,
      };
    } catch (error) {
      disposeRendererIntegration?.();
      console.error('[🔥 SERVICE-INIT] ❌❌❌ SERVICE INITIALIZATION FAILED:', error);
      console.error('[ServiceInitializer] 💥 服务初始化过程中出现严重错误:', error);
      throw error;
    }
  }

  /**
   * +++ 修改：返回 DatabaseService 实例 +++
   */
  private async initializeDatabaseService(): Promise<DatabaseService> {
    console.log('[ServiceInitializer] 💾 Step 1: 初始化数据库服务...');
    try {
      const dbService = getDatabaseService();
      dbService.initialize({
        lifecycleBootstrap: db => bootstrapBuiltinPluginLifecycle(db, this.applicationVersion),
      });
      console.log('[ServiceInitializer] ✅ Step 1: 数据库服务初始化成功');
      return dbService; // +++ 返回实例
    } catch (error) {
      console.error('[ServiceInitializer] ❌ Step 1: 数据库服务初始化失败:', error);
      throw error;
    }
  }

  /**
   * 准备环境变量映射
   */
  private async prepareEnvironmentVariables(): Promise<void> {
    console.log('[ServiceInitializer] 📋 Step 2: 准备环境变量映射...');

    const apiKeyEnvVars = [
      'OPENAI_API_KEY',
      'FEIAI_GEMINI_API_KEY',
      'DEEPSEEK_API_KEY',
      'FEIAI_DOUBAO_API_KEY',
      'SILICONFLOW_EMBEDDING_API_KEY',
      'SILICONFLOW_RERANK_API_KEY',
      'SILICONFLOW_QWEN_VL_API_KEY',
      'FEIAI_TRANSCRIPTION_API_KEY',
    ];

    for (const envVar of apiKeyEnvVars) {
      if (process.env[envVar]) {
        console.log(`[ServiceInitializer] ✓ 找到API密钥: ${envVar}`);
      } else {
        console.warn(`[ServiceInitializer] ✗ 缺少API密钥: ${envVar}`);
      }
    }

    console.log('[ServiceInitializer] ✅ Step 2: 环境变量映射准备完成');
  }

  /**
   * 初始化产品模型目录
   */
  private async initializeModelCatalog(
    _config: ServiceInitializationConfig
  ): Promise<() => void> {
    console.log('[ServiceInitializer] 🤖 Step 3: 初始化产品模型目录...');

    const systemCredentialCodec = getDesktopCredentialProtectionPort();
    modelCatalog.installEndpointCredentialCodec(systemCredentialCodec);
    providerAccountRegistry.installCredentialCodec(systemCredentialCodec);
    await providerAccountRegistry.initialize();
    await modelCatalog.initialize();
    await providerConfigurationRegistry.initialize({
      models: modelCatalog.getModels().map(model => ({
        id: model.id,
        inference_endpoint_id: model.inference_endpoint_id,
      })),
    });
    const providerConfigurationMigration = await runProviderConfigurationMigration({
      providerCatalog,
      runtimeBindings: providerOnboardingRuntimeBindingRegistry,
      modelCatalog,
      providerConfigurations: providerConfigurationRegistry,
      idFactory: { create: randomUUID },
    });
    await modelPickerPreferencesRegistry.initialize({
      configured_provider_ids: providerConfigurationRegistry.list().map(provider => provider.id),
      model_config_ids: modelCatalog.getModels().map(model => model.id),
    });
    console.log(
      `[ServiceInitializer] ✅ Step 3: 产品模型目录初始化完成，包含 ${modelCatalog.getModels().length} 个模型`
    );
    console.log('[ServiceInitializer] ✅ Provider 配置迁移完成', providerConfigurationMigration);

    // 安装“云端模型加载成功 → Renderer 刷新信号”桥接器。
    // 设计要点：
    // - 必须放在 modelCatalog.initialize() 之后；初始化内部已经触发了首次拉取，
    //   首次成功的事件可能在此之前就已经 emit（彼时无监听器，自然丢弃，无副作用）；
    // - 渲染进程在 main.js 启动时会主动 fetchModels 一次，所以"丢失首次事件"无害；
    // - 真正需要广播的是后台重试链路里成功的那一次——监听器一定能收到。
    return getBackendRendererIntegrationPort().connectModelCatalogUpdates();
  }

  /**
   * 初始化适配器
   */
  private async initializeAdapters(
    config: ServiceInitializationConfig,
    qdrantManagerConfig?: { url?: string }
  ): Promise<QdrantAdapter> {
    console.log('[ServiceInitializer] 🔌 Step 4: 初始化Qdrant适配器...');

    const qdrantConfig: QdrantConfig = {
      url: qdrantManagerConfig?.url || `http://localhost:6333`,
      apiKey: config.qdrant?.apiKey,
      timeout: config.qdrant?.timeout || 30000,
    };
    this.qdrantUrl = qdrantConfig.url;

    const qdrantAdapterInstance = QdrantAdapter.getInstance(qdrantConfig);
    console.log('[ServiceInitializer] ✅ Step 4: Qdrant适配器初始化完成');

    return qdrantAdapterInstance;
  }

  /**
   * 初始化知识库服务
   */
  private async initializeKnowledgeBaseService(
    qdrantAdapterInstance: QdrantAdapter,
    embedding: ReturnType<typeof createEmbeddingPort>,
    reranking: ReturnType<typeof createRerankingPort>,
    documentOcr: DocumentOcrPort
  ): Promise<KnowledgeBaseService> {
    console.log('[ServiceInitializer] 📚 Step 6: 初始化知识库服务依赖...');

    // 获取路径（SoT 与原始 PDF 仓储仍然使用文件系统）
    const sotPath = await pathManager.getSourceOfTruthPath();
    const originalDocumentsPath = await pathManager.getKnowledgeBaseOriginalsPath();

    console.log(
      `[ServiceInitializer] 🔍 主进程环境变量 LINNYA_DEV_MODE: ${process.env.LINNYA_DEV_MODE}`
    );
    console.log(`[ServiceInitializer] 🔍 主进程使用的SOT路径: ${sotPath}`);
    console.log(`[ServiceInitializer] 💡 元数据使用 workspace.sqlite (通过 DatabaseService)`);

    // 创建仓储实例 - 使用新的 BetterSqliteMetadataRepository
    const qdrantRepository = new QdrantRepositoryImpl(qdrantAdapterInstance);
    const databaseService = getDatabaseService();
    const metadataRepository = new BetterSqliteMetadataRepository(databaseService);
    const sotRepository = new FileSotRepository(sotPath);
    const originalDocumentRepository = new FileOriginalDocumentRepository(originalDocumentsPath);
    console.log('[ServiceInitializer] ✅ Step 6: 知识库存储库初始化完成');

    // 启动后一次性维护任务（Phase 2）：统一编排 workspace 清理 + 知识库一致性清理
    console.log('[ServiceInitializer] 🧹 Step 6.1: 调度启动维护任务(仅一次)...');
    scheduleStartupMaintenanceOnce({
      databaseService,
      metadataRepository,
      qdrantRepository,
      sotRepository,
      originalDocumentRepository,
    });
    console.log('[ServiceInitializer] ✅ Step 6.1: 启动维护任务已调度');

    // 创建搜索服务
    console.log('[ServiceInitializer] 🔍 Step 7: 创建搜索服务...');

    const knowledgeGraphRepository = new BetterSqliteKnowledgeGraphRepository(databaseService);
    const textGeneration = createTextGenerationPort({
      inferencePort: createDefaultHostInferencePort(),
    });
    const searchService = new DefaultSearchService({
      qdrantRepository,
      metadataRepository,
      sotRepository,
      embedding,
      reranking,
      knowledgeGraphRepository,
    });
    console.log('[ServiceInitializer] ✅ Step 7: 搜索服务创建完成');

    // 创建知识库服务
    console.log('[ServiceInitializer] 🛠️ Step 8: 初始化知识库服务 (无 IPC 回调)...');
    const knowledgeBaseService = new KnowledgeBaseCoordinator({
      metadataRepository,
      sotRepository,
      originalDocumentRepository,
      qdrantRepository,
      searchService,
      knowledgeGraphRepository,
      statusUpdatePublisher: getBackendRendererIntegrationPort().publishIngestionStatus,
      ingestionCapabilities: {
        embedding,
        textGeneration,
        documentOcr,
      },
    });
    console.log('[ServiceInitializer] ✅ Step 8: 知识库服务初始化完成');

    return knowledgeBaseService;
  }

  /**
   * 初始化项目-知识库关联服务
   */
  private async initializeProjectKnowledgeBaseLinksService(
    databaseService: DatabaseService
  ): Promise<ProjectKnowledgeBaseLinksService> {
    console.log('[ServiceInitializer] 🔗 Step 6.5: 初始化项目-知识库关联服务...');

    // 获取 metadataRepository 实例（从 knowledgeBaseService 获取）
    const metadataRepository = new BetterSqliteMetadataRepository(databaseService);

    const projectKnowledgeBaseLinksService = new ProjectKnowledgeBaseLinksService(
      databaseService,
      metadataRepository
    );

    console.log('[ServiceInitializer] ✅ Step 6.5: 项目-知识库关联服务初始化完成');
    return projectKnowledgeBaseLinksService;
  }

  /**
   * 初始化转录服务
   */
  private async initializeTranscriptionService(): Promise<TranscriptionService> {
    console.log('[ServiceInitializer] 🎤 Step 8: 初始化转录服务...');

    const transcriptionService = new TranscriptionService();
    console.log('[ServiceInitializer] ✅ Step 8: 转录服务初始化完成');

    return transcriptionService;
  }

  /**
   * 初始化队列系统
   */
  private async initializeQueueSystem(): Promise<void> {
    console.log('[ServiceInitializer] 🧵 Step 12: 初始化智能多线程队列系统...');

    try {
      const queueManager = QueueManager.getInstance();
      await queueManager.initialize({
        workerRuntime: this.queueWorkerRuntime,
        runtimePathRoots: this.runtimePathRoots,
        distributionIdentity: requireInstalledDistributionIdentity(),
        qdrantUrl: this.qdrantUrl ?? undefined,
        jobPresentationPublisher: getBackendRendererIntegrationPort().queueJobPresentationPublisher,
        ingestionLifecycleObserver: {
          onProgress: ({ job, data }) => {
            syncProgressToIngestionStore(data, { filename: job.data.filename });
          },
          onCompleted: ({ job, result }) => {
            syncCompletionToIngestionStore(result, { filename: job.data.filename });
          },
        },
      });
      console.log('[ServiceInitializer] ✅ Step 12: 智能多线程队列系统初始化成功');

      // Graph Queue Orchestration（feature 层）
      // 说明：这里启动“图谱抽取编排器”，让 task-queue 保持通用。
      const databaseService = getDatabaseService();
      const kgOrchestrator = new KnowledgeGraphQueueOrchestrator({
        queueManager,
        databaseService,
        publishGraphProgress: getBackendRendererIntegrationPort().publishKnowledgeGraphProgress,
      });
      kgOrchestrator.start();
      this.serviceRegistry.register('knowledgeGraphQueueOrchestrator', () => kgOrchestrator, true);
    } catch (queueError) {
      console.error('[ServiceInitializer] ❌ Step 12: 队列系统初始化失败:', queueError);
      throw new Error(`队列系统初始化失败: ${queueError}`);
    }
  }
}
