/**
 * @file src/electron-main/routes/index.ts
 *
 * @brief 路由聚合模块
 *
 * @description
 * 功能：聚合所有子路由模块，提供统一的路由配置接口
 * 输入：各种服务实例作为依赖
 * 输出：完整配置的Express应用实例
 * 副作用：将所有路由挂载到Express应用上
 */

import { Application } from 'express';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createModelRouter } from './modelRouter';
import { createProviderCatalogRouter } from './providerCatalogRouter';
import { createProviderOnboardingRouter } from './providerOnboardingRouter';
import { createCustomApiOnboardingRouter } from './customApiOnboardingRouter';
import { createOllamaOnboardingRouter } from './ollamaOnboardingRouter';
import { createModelPickerRouter } from './modelPickerRouter';
import { createProviderAccountRouter } from './providerAccountRouter';
import { createTranscriptionRouter } from '@transcription/index';
import { createStaticRouter } from './staticRouter';
import { createHealthRouter, type ServiceStatus } from './healthRouter';
import { createKnowledgeBaseRouter } from './knowledgeBaseRouter';
import type { KnowledgeBaseLookupPort } from 'src/features/knowledge-base/ingestion/functions/pdfOcrUploadPageLimit';
import type { DocumentOcrPort } from 'src/domains/document-ocr';
import { createProviderOutboundDebugRouter } from './providerOutboundDebugRouter';
import ollamaRouter from './ollamaRouter';
import { GraphExecutor, ToolNode, UserNode, WaitUserNode } from '@linnlabs/linnkit/runtime-kernel';
import { createDefaultLlmNode } from '../../app-hosts/linnya/adapters/runtime-assembly/graphRuntimeFactory';
import { SqliteCheckpointer } from '../../app-hosts/linnya/adapters/persistence/checkpointer/sqlite.implementation';
import { SqliteTelemetryAdapter } from '../../app-hosts/linnya/adapters/telemetry/sqlite.implementation';
import { bootstrapAgentRuntimeSingletons } from '../services/agentRuntimeSingletons';
import { createRegisteredChildRunInvoker } from 'src/app-hosts/linnya/adapters/child-runs/registeredSubagentInvoker';
import { providerCatalog } from '@linnya/provider-catalog';
import { modelCatalog } from 'src/domains/model-catalog';
import { providerConfigurationRegistry } from 'src/domains/provider-configuration';
import { modelPickerPreferencesRegistry } from 'src/domains/model-picker-preferences';
import { providerOnboardingRuntimeBindingRegistry } from 'src/app-hosts/linnya/adapters/inference';
import { createProviderOnboardingUseCase } from 'src/app-hosts/linnya/application/provider-onboarding';
import { createCustomApiOnboardingUseCase } from 'src/app-hosts/linnya/application/custom-api-onboarding';
import { createConfiguredModelRemovalUseCase } from 'src/app-hosts/linnya/application/configured-model-removal';
import { createOllamaOnboardingUseCase } from 'src/app-hosts/linnya/application/ollama-onboarding';
import { createModelPickerUseCase } from 'src/app-hosts/linnya/application/model-picker';
import { createChatGptOAuthLoopbackPort } from 'src/app-hosts/linnya/adapters/oauth-loopback/orchestration/createChatGptOAuthLoopbackPort';
import {
  createProviderAccountAuthorizationUseCase,
  type ExternalAuthorizationBrowserPort,
} from 'src/app-hosts/linnya/application/provider-account-authorization';
import { createProviderAccountModelProjection } from 'src/app-hosts/linnya/application/provider-account-model-projection';
import type { BackendBootstrapFacts } from 'src/app-hosts/linnya/backend-runtime';
import {
  CHATGPT_PROVIDER_ACCOUNT_ID,
  CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
  createChatGptAccountModelDiscovery,
  createChatGptOAuthTokenClient,
  providerAccountRegistry,
  providerAccountRequestCredentialResolver,
} from 'src/domains/provider-account';

/**
 * EngineState checkpoint 在 SQLite 里的保留窗口。
 * 默认 30 天；超过后启动时被 SqliteCheckpointer.purgeStale 清掉
 * （pending tool call 的行不动，避免误删真在等用户恢复的 case）。
 */
const ENGINE_CHECKPOINT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Telemetry 事件在 SQLite 里的保留窗口。
 * 默认 7 天——telemetry 是事后排查 debug 用，老数据无价值；
 * 写入频率比 checkpoint 高得多（每节点/每 tool/每 LLM 调用都一行），
 * 短窗口避免 engine_telemetry 表膨胀过快。
 */
const TELEMETRY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// 🔥 新模块化架构导入
import { SQLiteEventStore } from '../../app-hosts/linnya/adapters/persistence/event-store';
import {
  readAfter,
  readAround,
  readBefore,
  readRunFinalAnswer,
  readSubrunTrace,
  readTail,
  readTurnIndex,
} from '../../app-hosts/linnya/adapters/persistence/event-store/ui-projection/sqliteUiMessagesReader';
import { HistoryRepository } from '../../features/conversation/history/history.repository';
import { HistoryService } from '../../features/conversation/history/history.service';
import { createHistoryRouter } from '../../features/conversation/history/history.router';
import {
  createFlowHistoryAccessPort,
  HistoryHandlerService,
} from '../../app-hosts/linnya/adapters/flow/flow.history-handler.service';
import { AgentRunnerService } from '../../app-hosts/linnya/adapters/flow/flow.agent-runner.service';
import { FlowOrchestrator } from '../../app-hosts/linnya/adapters/flow/flow.orchestrator';
import { createConversationFlowRouter } from '../../app-hosts/linnya/adapters/flow/flow.router';
import { createConversationImageAttachmentRouter } from './conversationImageAttachmentRouter';
import { createWorkspaceImagePreviewRouter } from './workspaceImagePreviewRouter';
import {
  createConversationPersistencePort,
  createFlowConversationAdmissionPort,
  EventPersistenceCoordinator,
} from '../../app-hosts/linnya/adapters/flow/flow.persistence';
import {
  defaultObservationPreviewPort,
  defaultToolRuntimePort,
} from '../../app-hosts/linnya/adapters/tools/defaultPorts';
import { createToolModelInputCapabilityValidator } from '../../app-hosts/linnya/adapters/tools/modelInputCapabilityValidator';
import {
  createConversationFileLinkRuntime,
  registerConversationFileLinkRuntime,
} from '../../app-hosts/linnya/application/file-link';

// 导入服务类型
import { KnowledgeBaseService } from 'src/features/knowledge-base/index';
import { TranscriptionService } from '@transcription/index';
import { getLogger } from '../../shared/logger';
import { getDatabaseService } from '../services/database';
import {
  getAppDataPath,
  getConversationArtifactsV1Path,
  getConversationToolOutputBlobsDir,
  getWorkspaceRoot,
} from 'src/shared/utils/pathManager';
import { createConversationImageIngress } from 'src/features/conversation/attachments/features/image-ingress';
import type { ConversationImageIngressPort } from 'src/features/conversation/attachments/features/image-ingress';
import {
  createConversationAttachmentStoragePaths,
  createLegacyAppConversationAttachmentStoragePaths,
  createLegacyWorkspaceImageStoragePaths,
} from 'src/features/conversation/attachments/shared/storage-paths';
import { createWorkspaceLlmImageResolver } from 'src/features/workspace/assets/features/llm-image-resolution';
import { createWorkspaceImagePreview } from 'src/features/workspace/assets/features/image-preview';
import type { WorkspaceImagePreviewPort } from 'src/features/workspace/assets/features/image-preview';
import { createWorkspaceVerifiedImageLoader } from 'src/features/workspace/assets/shared/verified-image';
import { createWorkspaceToolModelInputResolver } from 'src/features/workspace/assets/features/tool-model-input';
import { createInMemoryToolResultAssetClaimRegistry } from 'src/domains/assets/features/tool-result-claims';
import { createManagedImageIngress } from 'src/domains/assets/features/managed-image-ingress';
import { readManagedImageStoreBinding } from 'src/domains/assets/features/managed-image-store-binding';
import { createSqliteLocalImageAssetLedger } from 'src/domains/assets/features/local-image-registration';
import { createEventStoreCommandExecutionAuditPort } from 'src/app-hosts/linnya/adapters/persistence/command-execution-audit';
import { createEventStoreExecutionAuditEventPort } from 'src/app-hosts/linnya/adapters/persistence/execution-audit-events';
import { createNodePhysicalFileReader } from 'src/app-hosts/linnya/adapters/file-read';
import { createWorkspaceAssetIdentityResolver } from 'src/features/workspace/assets/functions/createWorkspaceAssetIdentityResolver';
import { FlowIncomingEventPreparer } from 'src/app-hosts/linnya/adapters/flow/incoming-events/orchestration/prepareFlowIncomingEventBatch';
import { LINNYA_FLOW_IMAGE_INGRESS_POLICY } from 'src/app-hosts/linnya/adapters/flow/incoming-events/definitions/flowImageIngressPolicy';
import {
  createWorkspaceLlmInputMaterializer,
  defaultImageInputProcessingProfileRegistry,
} from 'src/app-hosts/linnya/adapters/llm-input-materialization';
import type {
  CommandAppOwnerLifecyclePort,
  CommandProductionScope,
} from 'src/app-hosts/linnya/adapters/commands/production-runtime';
import { projectCommandAgentRuntimes } from 'src/app-hosts/linnya/adapters/commands/production-runtime';
import {
  completeConversationRuntimeInitialization,
  ConversationRuntimeInitializationError,
  type ConversationExecutionRuntimeFactoryPort,
  type SandboxAppOwnerLifecyclePort,
  type SandboxProductionScope,
} from 'src/app-hosts/linnya/application/conversation-runtime';
import { installDefaultSandboxRunner } from 'src/features/sandbox';
import { createConversationRouteLifecycle } from './orchestration/createConversationRouteLifecycle';
import {
  CONVERSATION_WORK_DIRECTORY_CONTENT_DIRECTORY,
  CONVERSATION_WORK_DIRECTORY_NAMESPACE,
} from 'src/domains/conversation-files';
import { createSqliteConversationStorageCatalogPort } from 'src/app-hosts/linnya/adapters/persistence/storage-space/createSqliteConversationStorageCatalogPort';
import {
  createStorageSpaceUseCase,
  type StorageSpaceUseCasePort,
} from 'src/app-hosts/linnya/application/storage-space';
import { createLocalManagedStorageInventoryPort } from 'src/infra/adapters/storage-space/local-inventory';
import { createStorageSpaceRouter } from 'src/features/storage-space/storageSpace.router';
import { CONVERSATION_CONTROL_BRIDGE_PATH } from '@app/schemas';
import type { ConversationControlUseCase } from 'src/app-hosts/linnya/application/conversation-control';
import type { BackendRendererIntegrationPort } from 'src/app-hosts/linnya/desktop-capabilities';
import {
  createConversationControlBridgeRouter,
  createLinnyaConversationControlUseCase,
} from 'src/app-hosts/linnya/adapters/conversation-control-bridge';

const logger = getLogger('RouteConfig');

/**
 * 路由配置依赖接口
 */
export interface RouteDependencies {
  knowledgeBaseService?: KnowledgeBaseService;
  transcriptionService?: TranscriptionService;
  documentOcr: DocumentOcrPort;
  readonly backendBootstrap: BackendBootstrapFacts;
  readonly externalAuthorizationBrowser: ExternalAuthorizationBrowserPort;
  readonly rendererIntegration: BackendRendererIntegrationPort;
  readonly conversationExecutionRuntimeFactory: ConversationExecutionRuntimeFactoryPort;
  readonly commandOwnerLifecycleRegistration: {
    register(lifecycle: CommandAppOwnerLifecyclePort): void;
  };
  readonly sandboxOwnerLifecycleRegistration: {
    register(lifecycle: SandboxAppOwnerLifecyclePort): void;
  };
  // chatService 已移除，使用新的统一架构
}

export interface RouteConfigurationResult {
  conversationRoutesMounted: boolean;
  conversationControlBridgeMounted: boolean;
  conversationInitError?: string;
}

export interface RouteHostContext {
  readonly conversationControl: {
    readonly appInstanceId: string;
  };
}

function formatRouteInitError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  if (typeof error === 'string') {
    return error;
  }

  return 'unknown_error';
}

function isKnowledgeBaseLookupPort(
  service: KnowledgeBaseService
): service is KnowledgeBaseService & KnowledgeBaseLookupPort {
  return 'getKnowledgeBaseById' in service && typeof service.getKnowledgeBaseById === 'function';
}

/**
 * 配置所有路由
 *
 * @description
 * 功能：将所有子路由模块挂载到Express应用实例上
 * 输入：Express应用实例和服务依赖
 * 输出：路由配置结果（用于启动日志与健康检查）
 * 副作用：在应用实例上挂载所有路由
 *
 * @param app Express应用实例
 * @param dependencies 服务依赖对象
 */
export async function configureRoutes(
  app: Application,
  dependencies: RouteDependencies,
  hostContext: RouteHostContext
): Promise<RouteConfigurationResult> {
  logger.info('🚦 开始配置路由...');
  logger.info('🚀 使用新对话流程架构');

  let conversationRoutesMounted = false;
  let conversationControlBridgeMounted = false;
  let conversationInitErrorMessage: string | undefined;

  // 获取服务状态的函数
  const getServiceStatus = (): ServiceStatus => ({
    knowledgeBase: !!dependencies.knowledgeBaseService,
    chat: conversationRoutesMounted,
    transcription: !!dependencies.transcriptionService,
    agent: conversationRoutesMounted,
  });

  // ==================== 核心服务路由 ====================

  // 健康检查路由
  app.use('/health', createHealthRouter(getServiceStatus));
  logger.info('✅ 健康检查路由已挂载: /health');

  // 模型管理路由
  app.use('/api/v1/providers', createProviderCatalogRouter());
  logger.info('✅ Provider Catalog 路由已挂载: /api/v1/providers');
  const configuredModelRemoval = createConfiguredModelRemovalUseCase({
    modelCatalog,
    providerConfigurations: providerConfigurationRegistry,
    modelPickerPreferences: modelPickerPreferencesRegistry,
    idFactory: { create: randomUUID },
  });
  const chatGptAccountModels = createChatGptAccountModelDiscovery({
    credentials: providerAccountRequestCredentialResolver,
    fetchImplementation: fetch,
    clientVersion: dependencies.backendBootstrap.applicationVersion,
  });
  const providerOnboardingUseCase = createProviderOnboardingUseCase({
    providerCatalog,
    runtimeBindings: providerOnboardingRuntimeBindingRegistry,
    modelCatalog,
    providerConfigurations: providerConfigurationRegistry,
    providerAccounts: {
      findConnectedAccountId: providerConnectionDefinitionId =>
        providerAccountRegistry
          .list()
          .find(
            account =>
              account.provider_connection_definition_id === providerConnectionDefinitionId &&
              providerAccountRegistry.hasCredential(account.id)
          )?.id,
    },
    accountModels: {
      discoverModels: (providerConnectionDefinitionId, accountId) => {
        if (providerConnectionDefinitionId !== CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID) {
          throw new Error(`账号模型发现尚未注册 connection: ${providerConnectionDefinitionId}`);
        }
        return chatGptAccountModels.listModels(accountId);
      },
    },
    modelRemoval: {
      remove: async modelConfigId => {
        await configuredModelRemoval.remove(modelConfigId);
      },
    },
    idFactory: { create: randomUUID },
  });
  for (const configuredProvider of providerConfigurationRegistry.list()) {
    const catalogEntry = providerCatalog.getConnection(
      configuredProvider.provider_connection_definition_id
    );
    if (catalogEntry?.connection.model_discovery !== 'bundled') continue;
    try {
      await providerOnboardingUseCase.refreshRegisteredBundledProviderModels(
        configuredProvider.provider_connection_definition_id
      );
    } catch (error: unknown) {
      logger.warn('bundled Provider 已注册模型启动刷新失败', {
        provider_connection_definition_id:
          configuredProvider.provider_connection_definition_id,
        failure_type: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  const providerAccountModels = createProviderAccountModelProjection({
    modelCatalog,
    runtimeBindings: providerOnboardingRuntimeBindingRegistry,
  });
  if (providerAccountRegistry.hasCredential(CHATGPT_PROVIDER_ACCOUNT_ID)) {
    try {
      providerAccountModels.synchronize(
        CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
        CHATGPT_PROVIDER_ACCOUNT_ID
      );
      await providerOnboardingUseCase.synchronizeConnectedProviderModels(
        CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID
      );
    } catch (error: unknown) {
      logger.warn('ChatGPT 已授权账号模型启动同步失败', {
        provider_connection_definition_id: CHATGPT_PROVIDER_CONNECTION_DEFINITION_ID,
        failure_type: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
  const providerAccountAuthorization = createProviderAccountAuthorizationUseCase({
    accounts: providerAccountRegistry,
    chatGptTokens: createChatGptOAuthTokenClient(),
    loopback: createChatGptOAuthLoopbackPort(),
    browser: dependencies.externalAuthorizationBrowser,
    providerModels: providerOnboardingUseCase,
    accountModels: providerAccountModels,
  });
  app.use('/api/v1/provider-accounts', createProviderAccountRouter(providerAccountAuthorization));
  logger.info('✅ Provider account 路由已挂载: /api/v1/provider-accounts');
  app.use('/api/v1/provider-onboarding', createProviderOnboardingRouter(providerOnboardingUseCase));
  logger.info('✅ Provider onboarding 路由已挂载: /api/v1/provider-onboarding');
  const customApiOnboardingUseCase = createCustomApiOnboardingUseCase({
    modelCatalog,
    idFactory: { create: randomUUID },
  });
  app.use(
    '/api/v1/custom-api-onboarding',
    createCustomApiOnboardingRouter(customApiOnboardingUseCase)
  );
  logger.info('✅ Custom API onboarding 路由已挂载: /api/v1/custom-api-onboarding');
  const ollamaOnboardingUseCase = createOllamaOnboardingUseCase({
    providerCatalog,
    modelCatalog,
    providerConfigurations: providerConfigurationRegistry,
    idFactory: { create: randomUUID },
  });
  app.use('/api/v1/ollama-onboarding', createOllamaOnboardingRouter(ollamaOnboardingUseCase));
  logger.info('✅ Ollama onboarding 路由已挂载: /api/v1/ollama-onboarding');
  app.use('/api/v1/models', createModelRouter(configuredModelRemoval));
  logger.info('✅ 模型管理路由已挂载: /api/v1/models');
  const modelPickerUseCase = createModelPickerUseCase({
    providerCatalog,
    providerConfigurations: providerConfigurationRegistry,
    modelCatalog,
    preferences: modelPickerPreferencesRegistry,
    providerAccounts: providerAccountRegistry,
    providerModelActivation: providerOnboardingUseCase,
  });
  app.use('/api/v1/model-picker', createModelPickerRouter(modelPickerUseCase));
  logger.info('✅ 模型选择器路由已挂载: /api/v1/model-picker');

  // 静态文件路由
  app.use('/static', createStaticRouter());
  logger.info('✅ 静态文件路由已挂载: /static');

  // ==================== 业务服务路由 ====================

  // 转录服务路由
  if (dependencies.transcriptionService) {
    app.use('/api/v1/transcription', createTranscriptionRouter(
      dependencies.transcriptionService,
      dependencies.rendererIntegration.publishTranscriptionProgress,
    ));
    logger.info('✅ 转录服务路由已挂载: /api/v1/transcription');
  } else {
    logger.warn('⚠️ 转录服务未初始化，跳过路由挂载');
  }

  // 知识库服务路由
  if (dependencies.knowledgeBaseService) {
    if (!isKnowledgeBaseLookupPort(dependencies.knowledgeBaseService)) {
      throw new Error('知识库路由初始化失败：knowledgeBaseService 缺少 getKnowledgeBaseById。');
    }

    app.use(
      '/api/v1/knowledge-base',
      createKnowledgeBaseRouter(
        dependencies.knowledgeBaseService,
        dependencies.knowledgeBaseService,
        dependencies.documentOcr
      )
    );
    logger.info('✅ 知识库服务路由已挂载: /api/v1/knowledge-base');
  } else {
    logger.warn('⚠️ 知识库服务未初始化，跳过路由挂载');
  }

  // Provider outbound 快照只在开发环境暴露，且路由只持有只读 audit port。
  if (dependencies.backendBootstrap.exposeProviderOutboundDebugRoutes) {
    app.use('/api/v1/debug/provider-outbound', createProviderOutboundDebugRouter());
    logger.info('✅ Provider 调试路由已挂载: /api/v1/debug/provider-outbound/latest-attempt');
  } else {
    logger.info('ℹ️ 生产环境下未挂载 Provider outbound 调试路由');
  }

  // ==================== 会话服务路由（新模块化架构） ====================

  let flowOrchestrator: FlowOrchestrator | null = null;
  let historyService: HistoryService | null = null;
  let imageIngress: ConversationImageIngressPort | null = null;
  let imagePreview: WorkspaceImagePreviewPort | null = null;
  let commandProductionScope: CommandProductionScope | null = null;
  let sandboxProductionScope: SandboxProductionScope | null = null;
  let storageSpaceUseCase: StorageSpaceUseCasePort | null = null;
  let conversationControlUseCase: ConversationControlUseCase | null = null;
  let conversationInitError: unknown = null;

  try {
    logger.info('🔧 初始化会话服务...');
    const knowledgeBaseService = dependencies.knowledgeBaseService;
    if (!knowledgeBaseService) {
      throw new Error('会话服务初始化失败：knowledgeBaseService 不可用。');
    }

    // B1（linnkit Phase D 后续）: Checkpointer 改用 SQLite 实现，
    // EngineState 落 workspace.sqlite 的 engine_checkpoints 表，
    // 取代之前的进程级 in-memory（重启即丢）。
    logger.info('[诊断] 即将调用 getDatabaseService()');
    const dbService = getDatabaseService();
    logger.info('[诊断] 即将调用 dbService.getDb()');
    const db = dbService.getDb();
    const workspaceRoot = getWorkspaceRoot();
    const appDataRoot = getAppDataPath();
    const { storeId: managedImageStoreId } = readManagedImageStoreBinding(db);
    const attachmentPaths = createConversationAttachmentStoragePaths(
      appDataRoot,
      managedImageStoreId
    );
    const legacyAppAttachmentPaths = createLegacyAppConversationAttachmentStoragePaths(appDataRoot);
    const legacyAttachmentPaths = createLegacyWorkspaceImageStoragePaths(workspaceRoot);
    const verifiedImageLoader = createWorkspaceVerifiedImageLoader({
      db,
      storageBoundaries: [
        { boundaryRoot: appDataRoot, contentRoot: attachmentPaths.contentRoot },
        { boundaryRoot: appDataRoot, contentRoot: legacyAppAttachmentPaths.contentRoot },
        { boundaryRoot: workspaceRoot, contentRoot: legacyAttachmentPaths.contentRoot },
      ],
      maxImagePixels: LINNYA_FLOW_IMAGE_INGRESS_POLICY.maxImagePixels,
    });
    imagePreview = createWorkspaceImagePreview({ verifiedImageLoader });
    const llmInputMaterializer = createWorkspaceLlmInputMaterializer({
      profileRegistry: defaultImageInputProcessingProfileRegistry,
      workspaceResolver: createWorkspaceLlmImageResolver({
        verifiedImageLoader,
      }),
    });
    const toolResultAssetClaims = createInMemoryToolResultAssetClaimRegistry();
    const managedImageIngress = createManagedImageIngress({
      appDataRoot,
      storeId: managedImageStoreId,
      maxImageBytes: LINNYA_FLOW_IMAGE_INGRESS_POLICY.maxImageBytes,
      maxImagePixels: LINNYA_FLOW_IMAGE_INGRESS_POLICY.maxImagePixels,
      ledger: createSqliteLocalImageAssetLedger({ db }),
    });
    const toolModelInputResolver = createWorkspaceToolModelInputResolver({
      db,
      verifiedImageLoader,
      toolResultClaims: toolResultAssetClaims,
    });
    const checkpointer = new SqliteCheckpointer(db);
    const conversationEventStore = new SQLiteEventStore(db);
    const { runtime: agentRuntime, recoveredRuns } = await bootstrapAgentRuntimeSingletons({
      db,
      eventStore: conversationEventStore,
      llmInputMaterializer,
      toolModelInputResolver,
    });
    if (recoveredRuns.length > 0) {
      logger.warn('[RunSupervisor] 启动恢复已收口遗留的活跃 run', {
        recoveredCount: recoveredRuns.length,
        runIds: recoveredRuns.map(run => run.runId),
        errorCode: 'RUN_ABANDONED',
      });
    }
    const auditPort = agentRuntime.auditPort;
    logger.info('[诊断] new SQLiteEventStore(db) 调用已成功返回');

    // C1：启动时跑一次 GC，清理 30 天以上、无 pending tool call 的旧 checkpoint
    // 避免 engine_checkpoints 表随对话累计无限增长
    try {
      const purged = checkpointer.purgeStale({
        olderThanMs: ENGINE_CHECKPOINT_RETENTION_MS,
      });
      if (purged > 0) {
        logger.info(`[Checkpointer] 启动 GC：清理了 ${purged} 条 30+ 天旧 EngineState`);
      }
    } catch (gcErr) {
      logger.warn('[Checkpointer] 启动 GC 失败（不阻塞启动）', gcErr);
    }

    // B2-host: TelemetryPort 的宿主实现（SQLite + logger 双 sink）
    // - SQLite: workspace.sqlite/engine_telemetry 表（结构化、可查询、可聚合）
    // - logger: 控制台/日志文件实时输出，方便开发时跟事件流
    const tokenCalibrationCollector = agentRuntime.tokenCalibrationCollector;
    const telemetryPort = new SqliteTelemetryAdapter(
      db,
      logger,
      agentRuntime.costCollector,
      tokenCalibrationCollector
    );

    // 启动时跑一次 telemetry GC，清理 7 天以上的旧事件
    try {
      const purgedTelemetry = telemetryPort.purgeStale({
        olderThanMs: TELEMETRY_RETENTION_MS,
      });
      if (purgedTelemetry > 0) {
        logger.info(`[Telemetry] 启动 GC：清理了 ${purgedTelemetry} 条 7+ 天旧 telemetry 事件`);
      }
    } catch (gcErr) {
      logger.warn('[Telemetry] 启动 GC 失败（不阻塞启动）', gcErr);
    }

    // 🔥 初始化 GraphExecutor（注入 telemetryPort 以便 graph_node 事件落库）
    const executor = new GraphExecutor(checkpointer, {
      telemetryPort,
    });

    // 注册所有图节点（统一走静态 ESM import，避免 runtime require 字符串
    // 躲过 codemod / boundary guard 的静态分析）
    executor.registerNode(new UserNode());
    executor.registerNode(
      createDefaultLlmNode({
        telemetryPort,
        auditPort,
        tokenCalibrationCollector,
        llmInputMaterializer,
      })
    );
    executor.registerNode(
      new ToolNode({
        toolRuntime: defaultToolRuntimePort,
        observationPreview: defaultObservationPreviewPort,
        telemetryPort,
        auditPort,
        modelInputCapabilityValidator: createToolModelInputCapabilityValidator(),
        modelInputResolver: toolModelInputResolver,
      })
    );
    executor.registerNode(new WaitUserNode({ auditPort }));

    // 🔥 新架构：创建模块化服务
    // 1. 历史管理模块
    const historyRepository = new HistoryRepository(conversationEventStore, {
      readTail: (conversationId, limit) => readTail(db, conversationId, limit),
      readBefore: (conversationId, cursor, limit) => readBefore(db, conversationId, cursor, limit),
      readAfter: (conversationId, cursor, limit) => readAfter(db, conversationId, cursor, limit),
      readAround: (conversationId, anchorMessageId, limit) =>
        readAround(db, conversationId, anchorMessageId, limit),
      readRunFinalAnswer: (conversationId, runId) => readRunFinalAnswer(db, conversationId, runId),
      readTurnIndex: conversationId => readTurnIndex(db, conversationId),
      readSubrunTrace: (conversationId, parentToolCallId, subrunId, options) =>
        readSubrunTrace(db, conversationId, parentToolCallId, subrunId, options),
    });
    // 2. 流程协调模块 - 创建各个服务
    const historyHandler = new HistoryHandlerService(
      createFlowHistoryAccessPort(historyRepository)
    );
    // 这是当前 Backend App owner 的唯一 conversation lifecycle scope。Flow 与后续 History
    // 删除必须共享其中的 gate，私建第二个实例会重新打开 admission/cleanup 竞态窗口。
    const conversationLifecycle = createConversationRouteLifecycle({
      db,
      eventStore: conversationEventStore,
      storageRoot: appDataRoot,
    });
    registerConversationFileLinkRuntime(
      createConversationFileLinkRuntime({
        db,
        conversationWorkDirectoryAdmission: conversationLifecycle.workDirectoryAdmission,
      })
    );
    const physicalFileReader = createNodePhysicalFileReader();
    const executionRuntime = await dependencies.conversationExecutionRuntimeFactory.create({
      db,
      conversationAdmission: conversationLifecycle.workDirectoryAdmission,
      commandExecutionAudit: createEventStoreCommandExecutionAuditPort({ auditPort }),
      appDataRoot,
      commandArtifactStorageRoot: getConversationArtifactsV1Path(),
      resolveToolOutputBlobsDirectory: ({ conversationId, instanceId }) =>
        getConversationToolOutputBlobsDir({
          conversationId,
          instanceId,
        }),
    });
    commandProductionScope = executionRuntime.command;
    sandboxProductionScope = executionRuntime.sandbox;
    const commandPermissionSettings = executionRuntime.commandPermissionSettings;
    const commandScope = commandProductionScope;
    const commandAgentRuntimes = projectCommandAgentRuntimes(commandScope);
    const persistenceCoordinator = new EventPersistenceCoordinator({
      persistencePort: createConversationPersistencePort(historyRepository),
      conversationAdmission: createFlowConversationAdmissionPort(
        conversationLifecycle.persistenceAdmission
      ),
    });
    imageIngress = await createConversationImageIngress({
      appDataRoot,
      storeId: managedImageStoreId,
      policy: LINNYA_FLOW_IMAGE_INGRESS_POLICY,
    });
    const incomingEventPreparer = new FlowIncomingEventPreparer({
      kind: 'enabled',
      imageIngress,
      assetIdentity: createWorkspaceAssetIdentityResolver({ db }),
    });
    const registeredChildRunInvoker = createRegisteredChildRunInvoker({
      runtime: agentRuntime,
      telemetryPort,
      commandRuntime: commandAgentRuntimes.child,
    });
    const agentRunner = new AgentRunnerService(executor, knowledgeBaseService, dbService, {
      costCollector: agentRuntime.costCollector,
      registeredChildRunInvoker,
      commandPermissionSettings,
      workspaceMutationPublisher: {
        publish: event => dependencies.rendererIntegration.publishWorkspaceMutation(event),
      },
      physicalFileReader,
      conversationWorkDirectoryAdmission: conversationLifecycle.workDirectoryAdmission,
      managedImageIngress,
      toolResultAssetClaims: toolResultAssetClaims,
      commandRuntime: commandAgentRuntimes.root,
    });

    // 3. 创建编排器（统一只走 AgentRunner；旧编排概念已废弃）
    const initializedFlowOrchestrator = new FlowOrchestrator(
      historyHandler,
      agentRunner,
      persistenceCoordinator,
      incomingEventPreparer,
      agentRuntime
    );
    flowOrchestrator = initializedFlowOrchestrator;
    const conversationCleanup = conversationLifecycle.bindCleanup({
      commands: commandScope.conversationCleanupCommands,
      approvals: commandScope.conversationApprovalDeletion,
      commandCardSettlements: commandScope.conversationCardSettlementDeletion,
      stopFlowAndWait: conversationId =>
        initializedFlowOrchestrator.stopConversationActivityAndWait(conversationId),
    });
    storageSpaceUseCase = createStorageSpaceUseCase({
      catalog: createSqliteConversationStorageCatalogPort(db),
      inventory: createLocalManagedStorageInventoryPort({
        appDataRoot,
        workspaceRoot,
        conversationWorkFilesRoot: path.join(
          appDataRoot,
          CONVERSATION_WORK_DIRECTORY_NAMESPACE,
          'v1',
          CONVERSATION_WORK_DIRECTORY_CONTENT_DIRECTORY
        ),
        attachmentRoots: [
          attachmentPaths.managedRoot,
          legacyAppAttachmentPaths.managedRoot,
          legacyAttachmentPaths.managedRoot,
        ],
        diagnosticLogRoot: path.join(workspaceRoot, 'logs'),
        artifactsRoot: path.join(workspaceRoot, 'Artifacts', 'v1'),
      }),
      workDirectoryUsage: conversationLifecycle.workDirectoryUsage,
      cleanup: conversationCleanup,
    });

    // cleanup job 是崩溃前已经持久化的用户意图。必须在开放 History/Flow 路由前重放，
    // 否则旧对话可能先接收新消息，再被恢复流程删除。
    const cleanupRecovery = await conversationCleanup.recoverPending();
    if (cleanupRecovery.failures.length > 0) {
      logger.error('[ConversationCleanup] 启动恢复仍有未完成任务', {
        listedCount: cleanupRecovery.listedCount,
        completedCount: cleanupRecovery.completedCount,
        supersededCount: cleanupRecovery.supersededCount,
        failures: cleanupRecovery.failures.map(({ job, failure }) => ({
          conversationId: job.conversationId,
          jobId: job.jobId,
          code: failure.code,
          stage: failure.stage,
        })),
      });
    } else if (cleanupRecovery.listedCount > 0) {
      logger.info('[ConversationCleanup] 启动恢复已完成', cleanupRecovery);
    }

    const initializedHistoryService = new HistoryService(
      historyRepository,
      conversationCleanup,
      conversationCleanup
    );
    historyService = initializedHistoryService;
    conversationControlUseCase = createLinnyaConversationControlUseCase({
      flow: initializedFlowOrchestrator,
      runs: agentRuntime.supervisor,
      executionProgress: checkpointer,
      modelCatalog,
      providerAccounts: providerAccountRegistry,
      history: initializedHistoryService,
      telemetry: telemetryPort,
      events: createEventStoreExecutionAuditEventPort(conversationEventStore),
    });
    logger.info('✅ 历史管理服务已初始化');
    logger.info('✅ 流程编排器已初始化');
  } catch (e) {
    if (
      e instanceof ConversationRuntimeInitializationError
      && !commandProductionScope
      && !sandboxProductionScope
    ) {
      // Factory 已经创建过 production owner 并完成失败收口；不能把它降级成可重试的
      // “会话路由不可用”，否则同一 App 进程可能再次创建第二套 owner。
      throw e;
    }
    if (commandProductionScope || sandboxProductionScope) {
      const cleanupFailures: unknown[] = [];
      const endOwners: Array<() => Promise<void>> = [];
      if (commandProductionScope) {
        const commandScope = commandProductionScope;
        endOwners.push(() => commandScope.endOwnerAndWait());
      }
      if (sandboxProductionScope) {
        const sandboxScope = sandboxProductionScope;
        endOwners.push(() => sandboxScope.endOwnerAndWait());
      }
      for (const endOwner of endOwners) {
        try {
          await endOwner();
        } catch (cleanupFailure: unknown) {
          cleanupFailures.push(cleanupFailure);
        }
      }
      commandProductionScope = null;
      sandboxProductionScope = null;
      storageSpaceUseCase = null;
      throw new ConversationRuntimeInitializationError(e, cleanupFailures);
    }
    logger.error('⚠️ 会话服务初始化失败:', e);
    logger.error('错误堆栈:', e instanceof Error ? e.stack : '无堆栈信息');
    logger.error('💡 提示：请检查以下内容：');
    logger.error('  1. 数据库路径是否有写入权限');
    logger.error('  2. 环境变量 LINNYA_DEV_MODE 是否正确设置');
    logger.error('  3. 查看日志文件以获取详细错误信息');
    conversationInitError = e;
    conversationInitErrorMessage = formatRouteInitError(e);
  }

  // --- 路由挂载 ---
  if (
    historyService &&
    flowOrchestrator &&
    imageIngress &&
    imagePreview &&
    commandProductionScope &&
    sandboxProductionScope &&
    storageSpaceUseCase &&
    conversationControlUseCase
  ) {
    const preparedRoutes = await completeConversationRuntimeInitialization({
      commandScope: commandProductionScope,
      sandboxScope: sandboxProductionScope,
      prepareRoutes: () => ({
        attachments: createConversationImageAttachmentRouter({
          imageIngress,
          maxImageBytes: LINNYA_FLOW_IMAGE_INGRESS_POLICY.maxImageBytes,
        }),
        conversationImagePreview: createWorkspaceImagePreviewRouter({ imagePreview }),
        workspaceImagePreview: createWorkspaceImagePreviewRouter({ imagePreview }),
        history: createHistoryRouter(historyService),
        flow: createConversationFlowRouter(flowOrchestrator),
        storageSpace: createStorageSpaceRouter(storageSpaceUseCase),
      }),
      registerCommandOwner: lifecycle =>
        dependencies.commandOwnerLifecycleRegistration.register(lifecycle),
      registerSandboxOwner: lifecycle =>
        dependencies.sandboxOwnerLifecycleRegistration.register(lifecycle),
      installSandboxRunner: installDefaultSandboxRunner,
    });
    commandProductionScope = null;
    sandboxProductionScope = null;

    app.use('/api/v1/conversation', preparedRoutes.attachments);
    app.use('/api/v1/conversation', preparedRoutes.conversationImagePreview);
    app.use('/api/v1/workspace', preparedRoutes.workspaceImagePreview);
    app.use('/api/v1/conversation', preparedRoutes.history);
    app.use('/api/v1/conversation', preparedRoutes.flow);
    app.use('/api/v1/storage-space', preparedRoutes.storageSpace);
    app.use(
      CONVERSATION_CONTROL_BRIDGE_PATH,
      createConversationControlBridgeRouter({
        useCase: conversationControlUseCase,
        appInstanceId: hostContext.conversationControl.appInstanceId,
        appVersion: dependencies.backendBootstrap.applicationVersion,
        diagnostics: {
          error: (message, context) => logger.error(message, context),
        },
      })
    );
    conversationControlBridgeMounted = true;
    conversationRoutesMounted = true;
    logger.info('✅ 会话图片、预览、历史、流程、CLI 控制桥与存储空间路由已挂载');
  } else {
    logger.error('❌ 对话流程启动失败，无法挂载路由！初始化错误:', conversationInitError);
    conversationInitErrorMessage =
      conversationInitErrorMessage ?? formatRouteInitError(conversationInitError);
  }

  // 注意：旧的 /api/v1/generate 端点已移除
  // 前端应使用新的统一端点：/api/v1/conversation/next
  logger.info('ℹ️ 旧的 /api/v1/generate 端点已移除，请使用 /api/v1/conversation/next');

  // ==================== 第三方服务路由 ====================
  app.use('/api/v1/ollama', ollamaRouter);
  logger.info('✅ Ollama代理路由已挂载: /api/v1/ollama');

  if (conversationRoutesMounted) {
    logger.info('🎯 所有关键路由配置完成');
  } else {
    logger.error('⚠️ 路由配置部分完成：会话历史与会话流程路由不可用', {
      conversationInitError: conversationInitErrorMessage,
    });
  }

  return {
    conversationRoutesMounted,
    conversationControlBridgeMounted,
    conversationInitError: conversationInitErrorMessage,
  };
}

/**
 * 获取路由配置摘要
 *
 * @description
 * 功能：返回当前配置的路由摘要信息
 * 输入：服务依赖对象
 * 输出：路由配置摘要
 * 副作用：无
 *
 * @param dependencies 服务依赖对象
 * @returns 路由配置摘要
 */
export function getRouteSummary(
  dependencies: RouteDependencies,
  routeResult?: Pick<
    RouteConfigurationResult,
    'conversationRoutesMounted' | 'conversationControlBridgeMounted'
  >
) {
  const conversationRoutes = routeResult?.conversationRoutesMounted
    ? [
        'GET /api/v1/conversation/list',
        'GET /api/v1/conversation/:id/events/paginated',
        'GET /api/v1/conversation/:id/ui-messages/tail',
        'GET /api/v1/conversation/:id/ui-messages/before',
        'GET /api/v1/conversation/:id/ui-messages/after',
        'GET /api/v1/conversation/:id/ui-messages/around',
        'GET /api/v1/conversation/:id/turns',
        'GET /api/v1/conversation/:id/subrun-trace',
        'GET /api/v1/conversation/:id/metadata',
        'PUT /api/v1/conversation/:id/title',
        'PUT /api/v1/conversation/:id/pinned',
        'DELETE /api/v1/conversation/:id',
        'POST /api/v1/conversation/attachments/images',
        'DELETE /api/v1/conversation/attachments/images/:draftId',
        'GET /api/v1/conversation/assets/images/:assetId/content',
        'GET /api/v1/workspace/assets/images/:assetId/content',
        'GET /api/v1/storage-space/overview',
        'DELETE /api/v1/storage-space/conversations/:conversationId/work-directory',
        'POST /api/v1/conversation/next (统一端点，支持 Chat 和 Agent 模式)',
      ]
    : [];

  return {
    coreRoutes: [
      'GET /health',
      'GET /api/v1/providers',
      'GET /api/v1/providers/:providerDefinitionId',
      'POST /api/v1/provider-onboarding/direct-providers',
      'POST /api/v1/custom-api-onboarding/models',
      'GET /api/v1/models',
      'POST /api/v1/models',
      'PUT /api/v1/models/:id',
      'DELETE /api/v1/models/:id',
      'GET /static/images/:filename',
    ],
    serviceRoutes: {
      transcription: dependencies.transcriptionService
        ? ['POST /api/v1/transcription/transcribe']
        : [],
      chat: conversationRoutes,
      knowledgeBase: dependencies.knowledgeBaseService
        ? [
            'GET /api/v1/knowledge-base',
            'POST /api/v1/knowledge-base',
            'DELETE /api/v1/knowledge-base/:kbId',
            'POST /api/v1/knowledge-base/:kbId/documents',
            'GET /api/v1/knowledge-base/:kbId/documents',
            'DELETE /api/v1/knowledge-base/:kbId/documents/:docId',
            'POST /api/v1/knowledge-base/:kbId/search',
          ]
        : [],
      ppt: [],
      agent: routeResult?.conversationRoutesMounted ? ['POST /api/v1/conversation/next'] : [],
    },
    thirdPartyRoutes: ['POST /api/v1/ollama/tags'],
    conversationControlRoutes: routeResult?.conversationControlBridgeMounted
      ? [
          `POST ${CONVERSATION_CONTROL_BRIDGE_PATH}/handshake`,
          `POST ${CONVERSATION_CONTROL_BRIDGE_PATH}/commands`,
        ]
      : [],
  };
}
