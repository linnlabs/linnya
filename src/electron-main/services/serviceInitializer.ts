import { SQLiteRunRegistryStore } from 'src/app-hosts/linnya/adapters/persistence/run-registry';
import { selectRunRecoveryRetention } from 'src/app-hosts/linnya/application/run-resumption';
import { randomUUID } from 'node:crypto';
import { TranscriptionService } from '@transcription/index';
import {
  runManagedImageStartupMaintenance,
  runCommandOutputArtifactStartupMaintenance,
  runToolOutputStoreStartupMaintenance,
  scheduleStartupMaintenanceOnce,
  type StartupMaintenanceLifecycle,
} from './startup/startupMaintenanceRunner';
import {
  describeStartupCapabilityFailure,
  type StartupCapability,
  type StartupCapabilityFailure,
} from './startup/startupCapabilityFailure';
import { QueueManager } from 'src/infra/task-queue/queues';
import { modelCatalog } from 'src/domains/model-catalog';
import { providerCatalog } from '@linnya/provider-catalog';
import { providerConfigurationRegistry } from 'src/domains/provider-configuration';
import { modelPickerPreferencesRegistry } from 'src/domains/model-picker-preferences';
import { providerAccountRegistry } from 'src/domains/provider-account';
import {
  providerOnboardingRuntimeBindingRegistry,
  createLinnyaModelReasoningResolver,
} from 'src/app-hosts/linnya/adapters/inference';
import { runProviderConfigurationMigration } from 'src/app-hosts/linnya/application/provider-configuration-migration';
import { runCustomApiGroupMigration } from 'src/app-hosts/linnya/application/custom-api-onboarding';
import { getDatabaseService, DatabaseService, type DatabaseInitializeOptions } from './database';
import type { DatabaseStartupProgressPort } from './database/databaseStartupProgress';
import { setPluginRuntimeDatabase } from '../../app-hosts/linnya/plugin-registry/pluginRuntimeState';
import {
  bootstrapBuiltinPluginLifecycle,
  syncRegisteredBackendPluginRuntimeResources,
} from '../../app-hosts/linnya/plugin-registry/builtin';
import { createDocumentOcrPort } from 'src/app-hosts/linnya/adapters/document-ocr';
import type { DocumentOcrPort } from 'src/domains/document-ocr';
import type { QueueWorkerRuntime } from 'src/infra/task-queue/definitions/queueWorkerRuntime';
import type { RuntimePathRoots } from 'src/shared/runtime-paths';
/**
 * 服务初始化结果接口
 */
export interface InitializedServices {
  transcriptionService: TranscriptionService;
  databaseService: DatabaseService;
  documentOcr: DocumentOcrPort;
  /** 本次启动停掉的能力；为空表示全部启动成功。 */
  capabilityFailures: readonly StartupCapabilityFailure[];
}

const CAPABILITY_FAILURE_SUMMARIES: Readonly<Record<StartupCapability, string>> = Object.freeze({
  'knowledge-base': '知识库服务没有启动成功',
  'background-tasks': '后台任务队列没有启动成功',
  models: '模型配置没有加载成功',
});

/**
 * 服务初始化器类
 */
export class ServiceInitializer {
  private startupMaintenance: StartupMaintenanceLifecycle | null = null;

  constructor(
    private readonly queueWorkerRuntime: QueueWorkerRuntime,
    private readonly runtimePathRoots: RuntimePathRoots,
    private readonly applicationVersion: string,
    private readonly databaseStartupProgress?: DatabaseStartupProgressPort
  ) {}

  /**
   * 初始化所有应用服务
   *
   * @param config 服务配置
   * @param qdrantManagerConfig Qdrant管理器配置
   * @returns 初始化完成的服务实例
   */
  public async initializeServices(): Promise<InitializedServices> {
    console.log('[🔥 SERVICE-INIT] ===== initializeServices() METHOD CALLED =====');
    console.log('[ServiceInitializer] 🔧 开始详细的服务初始化...');

    const capabilityFailures: StartupCapabilityFailure[] = [];
    // 能力步骤失败只停掉这项能力并记一条诊断日志；必需步骤仍然直接抛出，由启动失败对话框说明。
    const runCapabilityStep = async <T>(
      capability: StartupCapability,
      step: () => Promise<T>
    ): Promise<T | null> => {
      try {
        return await step();
      } catch (error: unknown) {
        const failure = Object.freeze({
          capability,
          message: describeStartupCapabilityFailure(
            CAPABILITY_FAILURE_SUMMARIES[capability],
            error
          ),
        });
        capabilityFailures.push(failure);
        console.error(`[ServiceInitializer] 能力未启动: ${capability}`, error);
        return null;
      }
    };
    try {
      // 步骤1：初始化数据库服务
      const databaseService = await this.initializeDatabaseService();
      // 内容寻址文件 GC 必须在路由和 Agent ingress 开放前结束，否则旧孤儿回收
      // 可能删除本进程刚重新登记或尚未发布 manifest 的文件。
      // 在任何到期删除前读取上次进程的持久运行身份；不能等 Graph 恢复之后才补保护。
      const recoveryRetention = selectRunRecoveryRetention(
        (await new SQLiteRunRegistryStore(databaseService.getDb()).list({})).runs
      );
      await runManagedImageStartupMaintenance({ databaseService });
      await runCommandOutputArtifactStartupMaintenance({
        protectedConversationIds: recoveryRetention.conversationIds,
      });
      await runToolOutputStoreStartupMaintenance(recoveryRetention.conversationIds);
      setPluginRuntimeDatabase(databaseService.getDb());
      console.log('[🔥 SERVICE-INIT] initializeDatabaseService() completed.');

      // 步骤2：准备环境变量

      // 步骤3：初始化产品模型目录（能力：失败时模型相关入口说明原因，不覆写已有配置）
      await runCapabilityStep('models', () => this.initializeModelCatalog());

      const documentOcr = createDocumentOcrPort({ catalog: modelCatalog });
      // 模型 Host 已就绪后才激活插件。知识库 activation 不请求模型或启动向量服务。
      await syncRegisteredBackendPluginRuntimeResources();
      this.startupMaintenance = scheduleStartupMaintenanceOnce({ databaseService });

      // 步骤7：初始化转录服务
      const transcriptionService = await this.initializeTranscriptionService();

      // 步骤8：初始化队列系统（能力：知识库导入与长音频预处理不可用）
      await runCapabilityStep('background-tasks', () => this.initializeQueueSystem());

      if (capabilityFailures.length === 0) {
        console.log('[ServiceInitializer] ✨ 所有服务初始化成功!');
      } else {
        console.warn(
          `[ServiceInitializer] 服务初始化完成，未启动的能力: ${capabilityFailures
            .map(failure => failure.capability)
            .join(', ')}`
        );
      }

      return {
        transcriptionService,
        databaseService,
        documentOcr,
        capabilityFailures: Object.freeze([...capabilityFailures]),
      };
    } catch (error) {
      await this.stopStartupMaintenance();
      console.error('[🔥 SERVICE-INIT] ❌❌❌ SERVICE INITIALIZATION FAILED:', error);
      console.error('[ServiceInitializer] 💥 服务初始化过程中出现严重错误:', error);
      throw error;
    }
  }

  async stopStartupMaintenance(): Promise<void> {
    await this.startupMaintenance?.stop();
    this.startupMaintenance = null;
  }

  /**
   * +++ 修改：返回 DatabaseService 实例 +++
   */
  private async initializeDatabaseService(): Promise<DatabaseService> {
    console.log('[ServiceInitializer] 💾 Step 1: 初始化数据库服务...');
    try {
      const dbService = getDatabaseService();
      const initializeOptions: DatabaseInitializeOptions = {
        lifecycleBootstrap: db => bootstrapBuiltinPluginLifecycle(db, this.applicationVersion),
      };
      if (this.databaseStartupProgress) {
        // 宿主在这一阶段暂停启动超时，升级慢时显示进度；迁移步骤之间会让出事件循环。
        await dbService.initializeWithStartupProgress({
          ...initializeOptions,
          progress: this.databaseStartupProgress,
        });
      } else {
        dbService.initialize(initializeOptions);
      }
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
  private async initializeModelCatalog(): Promise<void> {
    console.log('[ServiceInitializer] 🤖 Step 3: 初始化产品模型目录...');

    modelCatalog.installModelReasoningResolver(createLinnyaModelReasoningResolver());
    await providerAccountRegistry.initialize();
    await modelCatalog.initialize();
    // 停用的用户模型仍在用户文件里，对账必须把它当作存在，否则会顺带删掉它的 Provider 归属与选择器偏好。
    const modelIdentities = modelCatalog.getModelIdentitiesIncludingUnadmitted();
    await providerConfigurationRegistry.initialize({ models: modelIdentities });
    const providerConfigurationMigration = await runProviderConfigurationMigration({
      providerCatalog,
      runtimeBindings: providerOnboardingRuntimeBindingRegistry,
      modelCatalog,
      providerConfigurations: providerConfigurationRegistry,
      idFactory: { create: randomUUID },
    });
    // 正式 Provider 的恢复和旧归属迁移完成后，才能明确剩余用户模型的自定义分组。
    await runCustomApiGroupMigration({
      modelCatalog,
      providerMembership: providerConfigurationRegistry,
    });
    await modelPickerPreferencesRegistry.initialize({
      configured_provider_ids: providerConfigurationRegistry.list().map(provider => provider.id),
      model_config_ids: modelIdentities.map(model => model.id),
    });
    console.log(
      `[ServiceInitializer] ✅ Step 3: 产品模型目录初始化完成，包含 ${modelCatalog.getModels().length} 个模型`
    );
    console.log('[ServiceInitializer] ✅ Provider 配置迁移完成', providerConfigurationMigration);
  }

  /**
   * 初始化适配器
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
    await QueueManager.getInstance().initialize({ workerRuntime: this.queueWorkerRuntime });
  }
}
