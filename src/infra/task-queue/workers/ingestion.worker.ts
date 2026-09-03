/**
 * @file src/task-queue/workers/ingestion.worker.ts
 *
 * @brief 文档摄入Worker - 基于状态机驱动
 *
 * @description
 * 功能 (What): 在独立线程中处理文档摄入任务，由状态机驱动
 * 输入 (Input): 通过workerData接收IngestionJobPayload
 * 输出 (Output): 状态机通过监听器发送进度和结果
 * 副作用 (Side-effects): 启动并运行完整的文档摄入状态机
 */

import { parentPort, workerData } from 'worker_threads';
import { IngestionJobPayload } from '../jobs';
import {
  IngestionStateMachineManager,
  validateIngestionParams,
} from '../../../features/knowledge-base/ingestion/IngestionStateMachineManager';
import { InternalStage } from '../../../features/knowledge-base/ingestion/definitions/state';

import { modelCatalog } from 'src/domains/model-catalog';

// 🔥 新增：导入并配置日志记录器
import { enableDiagnosticLogForwarding, Logger } from '../../../shared/logger';

import fs from 'fs';
import { pathManager } from '../../../shared/utils/pathManager';
import {
  installRuntimePathRoots,
  type RuntimePathRoots,
} from '../../../shared/runtime-paths';
import {
  installDistributionIdentity,
  type DistributionIdentity,
} from '../../../shared/distribution-identity';
import { getDatabaseService } from '../../../electron-main/services/database';
import { BetterSqliteMetadataRepository } from '../../../features/knowledge-base/infrastructure/sqlite/better-sqlite-metadata.repository';
import { cleanupFailedDocument } from '../../../features/knowledge-base/ingestion/failureCleanup';
import { FileSotRepository } from '../../../features/knowledge-base/infrastructure/sotRepository';
import { FileOriginalDocumentRepository } from '../../../features/knowledge-base/infrastructure/fileOriginalDocumentRepository';
import { QdrantRepositoryImpl } from '../../../features/knowledge-base/infrastructure/QdrantRepositoryImpl';
import { QdrantAdapter } from '../../../infra/adapters/vector-store/index';
import { BetterSqliteKnowledgeGraphRepository } from '../../../features/knowledge-base/graph/infrastructure/better-sqlite-knowledge-graph.repository';
import type { IngestionStateMachineRepositories } from '../../../features/knowledge-base/ingestion/IngestionStateMachineManager';
import {
  createDefaultHostInferencePort,
  createEmbeddingPort,
  createTextGenerationPort,
} from '../../../app-hosts/linnya/adapters/inference';
import type { EmbeddingPort } from '../../../domains/model-inference';
import { createDocumentOcrPort } from '../../../app-hosts/linnya/adapters/document-ocr';

if (parentPort) {
  const diagnosticPort = parentPort;
  enableDiagnosticLogForwarding(envelope => diagnosticPort.postMessage(envelope));
}
console.log(`[IngestionWorker] 📋 Worker received data:`, JSON.stringify(workerData, null, 2));

const logger = new Logger('IngestionWorker');

// Worker线程启动
logger.info(`🚀 Worker脚本启动`);

// 🔥 立即诊断Worker环境
function immediateWorkerDiagnostics() {
  logger.info(`=== 🔍 Worker线程环境诊断开始 ===`);
  logger.info(`📁 当前工作目录: ${process.cwd()}`);
  logger.info(`🔑 重要环境变量:`);
  logger.info(
    `  - MODEL_REGISTRY_DEFAULTS_PATH: ${process.env.MODEL_REGISTRY_DEFAULTS_PATH || '未设置'}`
  );
  logger.info(`  - LINNYA_DEV_MODE: ${process.env.LINNYA_DEV_MODE || '未设置'}`);
  logger.info(`  - NODE_ENV: ${process.env.NODE_ENV || '未设置'}`);

  // 立即检查模型文件路径
  if (process.env.MODEL_REGISTRY_DEFAULTS_PATH) {
    const exists = fs.existsSync(process.env.MODEL_REGISTRY_DEFAULTS_PATH);
    logger.info(
      `📄 默认模型文件: ${process.env.MODEL_REGISTRY_DEFAULTS_PATH} - ${exists ? '存在' : '不存在'}`
    );
  }
  logger.info(`=== 🔍 Worker线程环境诊断结束 ===`);
}

// 立即运行诊断
immediateWorkerDiagnostics();

function installWorkerRuntimePathRoots(): void {
  const runtimePathRoots = (
    workerData as { readonly runtimePathRoots?: RuntimePathRoots } | undefined
  )?.runtimePathRoots;
  if (!runtimePathRoots) {
    throw new Error('[IngestionWorker] 缺少 owner 传入的 Runtime path roots');
  }
  installRuntimePathRoots(runtimePathRoots);
}

function installWorkerDistributionIdentity(): DistributionIdentity {
  const distributionIdentity = (
    workerData as { readonly distributionIdentity?: DistributionIdentity } | undefined
  )?.distributionIdentity;
  if (!distributionIdentity) {
    throw new Error('[IngestionWorker] 缺少 owner 传入的 Desktop distribution identity');
  }
  return installDistributionIdentity(distributionIdentity);
}

// 全局状态标志
let isCancelled = false;
let isPaused = false;

function getWorkerEnvVars(): Record<string, string> {
  return (
    (
      workerData as
        | (Partial<IngestionJobPayload> & { envVars?: Record<string, string> })
        | undefined
    )?.envVars ?? {}
  );
}

function resolveWorkerQdrantUrl(): string {
  const qdrantUrl = getWorkerEnvVars().QDRANT_URL || process.env.QDRANT_URL;
  if (!qdrantUrl || qdrantUrl.trim().length === 0) {
    throw new Error(
      '[IngestionWorker] 缺少 QDRANT_URL：主进程必须通过 workerData.envVars 透传向量库地址'
    );
  }
  return qdrantUrl;
}

function createIngestionRepositories(
  databaseService = getDatabaseService()
): IngestionStateMachineRepositories {
  databaseService.initializeConnectionOnly();
  const metadataRepository = new BetterSqliteMetadataRepository(databaseService);
  const knowledgeGraphRepository = new BetterSqliteKnowledgeGraphRepository(databaseService);
  const sotRepository = new FileSotRepository(pathManager.getSourceOfTruthPath());
  const originalDocumentRepository = new FileOriginalDocumentRepository(
    pathManager.getKnowledgeBaseOriginalsPath()
  );
  const qdrantAdapter = QdrantAdapter.getInstance({ url: resolveWorkerQdrantUrl() });
  const qdrantRepository = new QdrantRepositoryImpl(qdrantAdapter);

  return {
    metadataRepository,
    qdrantRepository,
    sotRepository,
    originalDocumentRepository,
    knowledgeGraphRepository,
  };
}

/**
 * 功能 (What): 初始化Worker环境
 * 输入 (Input): 无
 * 输出 (Output): 无
 * 副作用 (Side-effects): 在 Worker 线程中初始化必要的窄能力端口与仓储
 */
async function initializeWorkerServices(): Promise<EmbeddingPort> {
  logger.info(`🔧 初始化Worker环境服务...`);

  // 🔥 新增：首先修复Worker环境
  installWorkerRuntimePathRoots();
  const distributionIdentity = installWorkerDistributionIdentity();

  try {
    // 路径合法性由 Model Catalog 唯一入口校验，worker 不重复探测或选择目录。
    await modelCatalog.initialize(distributionIdentity);

    const embeddingModels = modelCatalog.getModelsByCapability('embedding');
    logger.info(`🔍 可用的嵌入模型: [${embeddingModels.map(m => m.id).join(', ')}]`);

    const embedding = createEmbeddingPort({ catalog: modelCatalog });

    logger.info(`✅ Worker环境服务初始化完成`);
    return embedding;
  } catch (error) {
    logger.error(`❌ Worker环境服务初始化失败:`, error);
    throw error;
  }
}

/**
 * 功能 (What): 主要的文档摄入处理函数
 * 输入 (Input): IngestionJobPayload数据（通过workerData传递）
 * 输出 (Output): 无（状态机通过消息传递返回结果）
 * 副作用 (Side-effects): 启动文档摄入状态机
 */
async function processIngestionJob(): Promise<void> {
  const jobData: IngestionJobPayload = workerData;

  if (!jobData) {
    sendMessage('failed', 'Worker未接收到任务数据');
    return;
  }

  logger.info(`开始处理: ${jobData.filename}`);

  let embedding: EmbeddingPort;
  try {
    embedding = await initializeWorkerServices();
  } catch (error) {
    logger.error(`Worker环境初始化失败: ${error}`);
    sendMessage(
      'failed',
      `Worker环境初始化失败: ${error instanceof Error ? error.message : String(error)}`
    );
    return;
  }

  // 检查是否在启动前就被取消了
  if (isCancelled) {
    logger.info(`任务在启动前被取消: ${jobData.taskId}`);
    sendMessage('failed', '任务已取消');
    return;
  }

  // 验证输入参数
  const { isValid, error } = validateIngestionParams(jobData);
  if (!isValid) {
    logger.error(`任务参数无效: ${error}`);
    sendMessage('failed', `任务参数无效: ${error}`);
    return;
  }

  try {
    // 重要：Worker 线程内需要独立的 DB 连接（与主线程不共享内存）。
    // 只建连接 + 设 pragma，不重跑迁移/插件 lifecycle（F1-02）：主进程启动时已完成 initialize()。
    const repositories = createIngestionRepositories();
    const textGeneration = createTextGenerationPort({
      inferencePort: createDefaultHostInferencePort(),
    });
    const documentOcr = createDocumentOcrPort({ catalog: modelCatalog });

    const manager = IngestionStateMachineManager.create({
      embedding,
      textGeneration,
      documentOcr,
      repositories,
      progressCallback: (stage, progress, message, error) => {
        // 在每个回调中检查取消状态
        if (isCancelled) {
          logger.info(`检测到取消信号，阶段: ${stage}`);
          throw new Error('TaskCancelledError');
        }

        if (isPaused) {
          logger.info(`检测到暂停信号，阶段: ${stage}`);
          throw new Error('TaskPausedError');
        }

        // 🔥 修复：正确处理进度更新，确保前端状态同步
        logger.debug(`进度更新: ${stage} (${progress}%) - ${message}`);
        if (error) {
          logger.error(`处理错误: ${error}`);
        }
      },
    });

    // 🔥 修复：执行状态机流程，确保失败清理能正常工作
    logger.info(`[IngestionWorker] 开始执行状态机流程: ${jobData.taskId}`);

    let result;
    try {
      result = await manager.processDocument(jobData);
      logger.info(
        `[IngestionWorker] 状态机流程执行完成: ${jobData.taskId}, success=${result.success}, stage=${result.newStage}`
      );

      if (!result.success) {
        logger.warn(`[IngestionWorker] 状态机返回失败结果: ${result.error}`);
      }
    } catch (stateMachineError) {
      logger.error(
        `[IngestionWorker] 状态机执行时发生异常: ${stateMachineError instanceof Error ? stateMachineError.message : String(stateMachineError)}`,
        stateMachineError
      );
      // 创建失败结果
      result = {
        success: false,
        newStage: InternalStage.FAILED,
        context: jobData,
        error: `状态机执行异常: ${stateMachineError instanceof Error ? stateMachineError.message : String(stateMachineError)}`,
      };
    }

    if (isCancelled) {
      logger.info(`任务在完成前被取消: ${jobData.taskId}`);
      sendMessage('failed', '任务已取消');
      return;
    }

    if (result.success) {
      logger.info(`状态机流程成功结束: ${result.newStage}`);
      // 成功消息已经通过状态机的监听器发送，这里不需要额外处理
      process.exit(0);
    } else {
      logger.info(`状态机流程失败: ${result.error}`);
      // 🔥 修复：失败已经由状态机的 handleFailure 处理完毕（包括清理），
      // Worker 只需要发送最终失败状态，不需要额外的失败处理
      sendMessage('failed', result.error || '状态机处理失败');
      return; // 确保不继续执行
    }
  } catch (err) {
    if (err instanceof Error) {
      if (err.message === 'TaskCancelledError') {
        logger.info(`任务已被用户取消: ${jobData.taskId}`);
        sendMessage('failed', '任务已取消');
        // 🔥 优化：正常退出，避免异常退出码
        process.exit(0);
      }

      if (err.message === 'TaskPausedError') {
        logger.info(`任务已被用户暂停: ${jobData.taskId}`);
        sendMessage('failed', '任务已暂停');
        return;
      }
    }

    const errorMessage = `文档摄入任务发生未捕获的严重错误: ${err instanceof Error ? err.message : String(err)}`;
    logger.error(`${errorMessage}`, err);

    // 🔥 关键修复：调用紧急清理函数
    if (jobData) {
      await cleanupOnWorkerCrash(jobData.docId, jobData.kbId);
    }

    sendMessage('failed', errorMessage);
  }
}

/**
 * 🔥 新增：Worker发生严重错误时的紧急清理函数
 * 功能 (What): 在状态机无法处理的致命错误发生时，提供最后的清理机会
 * 输入 (Input): docId, kbId
 * 输出 (Output): 无
 * 副作用 (Side-effects): 调用通用的清理函数，删除三大数据源中的相关数据
 */
async function cleanupOnWorkerCrash(docId: string, kbId: string): Promise<void> {
  logger.info(`[IngestionWorker] 🚨 Worker 发生严重错误，开始紧急清理: ${docId}`);
  try {
    // 重新创建依赖实例进行清理（worker 上下文，只建连接，不重跑迁移/插件 lifecycle，F1-02）
    const {
      metadataRepository,
      qdrantRepository,
      sotRepository,
      originalDocumentRepository,
      knowledgeGraphRepository,
    } = createIngestionRepositories();

    await cleanupFailedDocument(
      docId,
      kbId,
      metadataRepository,
      qdrantRepository,
      sotRepository,
      knowledgeGraphRepository,
      originalDocumentRepository
    );
    logger.info(`[IngestionWorker] ✅ 紧急清理成功: ${docId}`);
  } catch (cleanupError) {
    logger.error(`[IngestionWorker] ❌ 紧急清理失败: ${docId}`, cleanupError);
  }
}

/**
 * 功能 (What): 向主线程发送消息 (备用)
 * 输入 (Input): 消息类型和数据
 * 输出 (Output): 无
 * 副作用 (Side-effects): 发送消息到主线程
 */
type WorkerMessageType = 'progress' | 'completed' | 'failed';
type WorkerOutboundMessage =
  | { type: 'failed'; timestamp: number; error: string }
  | { type: 'progress'; timestamp: number; frontendState: unknown }
  | { type: 'completed'; timestamp: number; result: unknown };

function sendMessage(type: WorkerMessageType, data: unknown): void {
  if (parentPort) {
    const timestamp = Date.now();
    const msg: WorkerOutboundMessage =
      type === 'failed'
        ? { type: 'failed', timestamp, error: typeof data === 'string' ? data : String(data) }
        : type === 'completed'
          ? { type: 'completed', timestamp, result: data }
          : { type: 'progress', timestamp, frontendState: data };

    parentPort.postMessage(msg);
  }
}

// 监听主线程消息（任务控制）
if (parentPort) {
  parentPort.on('message', message => {
    logger.info(`收到主线程消息:`, message);

    if (message.cmd === 'cancel') {
      logger.info(`收到取消信号`);
      isCancelled = true;
    } else if (message.cmd === 'pause') {
      logger.info(`收到暂停信号`);
      isPaused = true;
    }
  });
}

// 启动处理
// 🔥 移除顶层catch，所有逻辑移入processIngestionJob的try-catch中
processIngestionJob();

export default processIngestionJob;
