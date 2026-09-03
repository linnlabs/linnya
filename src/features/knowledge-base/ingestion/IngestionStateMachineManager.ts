/**
 * @file src/knowledge-base/ingestion/IngestionStateMachineManager.ts
 *
 * @brief 文档摄入状态机管理器
 *
 * @description
 * 功能 (What): 组装并管理完整的文档摄入状态机流程
 * 输入 (Input): 文档摄入任务参数
 * 输出 (Output): 完整的处理结果和状态更新
 * 副作用 (Side-effects): 协调所有状态处理器，管理状态转换，通知进度更新
 *
 * 🔥 重构修复说明 (2024):
 * 1. 统一状态映射逻辑：移除分散的状态映射代码，只使用IngestionStateMachine.createFrontendState()
 * 2. 重复文件检测：移动到PendingHandler中，确保所有状态变化都通过状态机
 * 3. 标准化IPC格式：所有状态推送都包含完整的阶段信息(stage, stage_progress)
 */

import { Logger } from 'src/shared/logger';
import { IngestionStateMachine, createInitialContext, createStateMachine } from './stateMachine';
import {
  InternalStage,
  type IngestionFrontendState,
  type StateTransitionResult,
  type TaskContext,
} from './definitions/state';
import { PendingHandler } from './handlers/PendingHandler';
import { ParsingHandler } from './handlers/ParsingHandler';
import { EmbeddingHandler } from './handlers/EmbeddingHandler';
import { StoringHandler } from './handlers/StoringHandler';
import {
  createIngestionProgressSnapshot,
  updateIngestionProgress,
} from './store/ingestionProgressStore';
import type { MetadataRepository } from '../infrastructure/metadataRepository';
import type { QdrantRepository } from '../infrastructure/qdrantRepository';
import type { SotRepository } from '../infrastructure/sotRepository';
import type { OriginalDocumentRepository } from '../infrastructure/originalDocumentRepository';
import type { KnowledgeGraphRepository } from '../graph/infrastructure/knowledgeGraphRepository';
import type { StatusUpdatePublisher } from './definitions/statusUpdate';
import type { EmbeddingPort, TextGenerationPort } from 'src/domains/model-inference';
import type { DocumentOcrPort } from 'src/domains/document-ocr';

const logger = new Logger('IngestionStateMachineManager');

/**
 * 摄入任务参数接口
 */
export interface IngestionTaskParams {
  taskId: string;
  docId: string;
  kbId: string;
  filename: string;
  filePath: string;
  embeddingModelId: string;
  pdfOcrModelId?: string;
  imageVisionModelId?: string;
  visionModelId?: string;
  rerankModelId?: string;
  graphExtractionModelId?: string;
  forceVisionMode?: boolean; // �� 新增：强制视觉模式设置
}

/**
 * 进度回调函数类型
 */
export type ProgressCallback = (
  stage: InternalStage,
  progress: number,
  message: string,
  error?: string
) => void;

export interface IngestionStateMachineRepositories {
  readonly metadataRepository: MetadataRepository;
  readonly qdrantRepository: QdrantRepository;
  readonly sotRepository: SotRepository;
  readonly originalDocumentRepository: OriginalDocumentRepository;
  readonly knowledgeGraphRepository: KnowledgeGraphRepository;
}

/**
 * 状态机管理器配置选项
 */
export interface StateMachineManagerOptions {
  progressCallback?: ProgressCallback;
  /**
   * 非 Worker 运行时的状态推送由主进程显式注入。
   * Worker 只通过 parentPort 汇报进度，不能静态依赖 Electron presentation adapter。
   */
  statusUpdatePublisher?: StatusUpdatePublisher;
  repositories: IngestionStateMachineRepositories;
  embedding: EmbeddingPort;
  textGeneration: TextGenerationPort;
  documentOcr: DocumentOcrPort;
}

export interface IngestionStateMachineStatistics {
  readonly registeredHandlers: readonly InternalStage[];
  readonly managerVersion: string;
  readonly architecture: 'state-machine';
  readonly createdAt: string;
}

/**
 * 功能 (What): 文档摄入状态机管理器
 * 输入 (Input): 任务参数和进度回调
 * 输出 (Output): 完整的文档摄入结果
 * 副作用 (Side-effects): 管理整个文档摄入生命周期，实时更新进度
 */
export class IngestionStateMachineManager {
  private stateMachine: IngestionStateMachine;
  private progressCallback?: ProgressCallback;
  private statusUpdatePublisher?: StatusUpdatePublisher;
  private readonly repositories: IngestionStateMachineRepositories;
  private readonly embedding: EmbeddingPort;
  private readonly textGeneration: TextGenerationPort;
  private readonly documentOcr: DocumentOcrPort;
  private lastProgressUpdateTimestamp = 0;
  private lastReportedProgress = -1;

  constructor(options: StateMachineManagerOptions) {
    this.progressCallback = options.progressCallback;
    this.statusUpdatePublisher = options.statusUpdatePublisher;
    this.repositories = options.repositories;
    this.embedding = options.embedding;
    this.textGeneration = options.textGeneration;
    this.documentOcr = options.documentOcr;
    this.stateMachine = this.createConfiguredStateMachine();

    logger.info('[StateMachineManager] 文档摄入状态机管理器已初始化');
  }

  /**
   * 功能 (What): 创建并配置状态机（使用依赖注入获取依赖）
   * 输入 (Input): 无
   * 输出 (Output): 配置好的状态机实例
   * 副作用 (Side-effects): 注册所有状态处理器和监听器
   */
  private createConfiguredStateMachine(): IngestionStateMachine {
    const stateMachine = createStateMachine(
      this.repositories.metadataRepository,
      this.repositories.qdrantRepository,
      this.repositories.sotRepository,
      this.repositories.knowledgeGraphRepository,
      this.repositories.originalDocumentRepository
    );

    this.registerStateHandlers(stateMachine);

    // 注册状态变化监听器
    stateMachine.addListener((context: TaskContext, stage: InternalStage) => {
      this.handleStateChange(context, stage);
    });

    logger.info('[StateMachineManager] 状态机配置完成，已注册所有处理器');
    return stateMachine;
  }

  /**
   * 功能 (What): 注册状态处理器
   * 输入 (Input): 状态机实例
   * 输出 (Output): 无
   * 副作用 (Side-effects): 向状态机注册所有处理器
   */
  private registerStateHandlers(stateMachine: IngestionStateMachine): void {
    const pendingHandler = new PendingHandler(this.repositories.metadataRepository);
    stateMachine.registerHandler(InternalStage.PENDING, pendingHandler);

    // 🔥 新增：为ParsingHandler创建进度回调，实现实时进度更新
    const parsingProgressCallback = (context: TaskContext) => {
      // 立即通知状态机进度变化，触发前端更新
      this.handleStateChange(context, InternalStage.PARSING);
    };

    const parsingHandler = new ParsingHandler(
      this.textGeneration,
      this.documentOcr,
      parsingProgressCallback
    );
    stateMachine.registerHandler(InternalStage.PARSING, parsingHandler);

    const embeddingHandler = new EmbeddingHandler(this.embedding);
    stateMachine.registerHandler(InternalStage.EMBEDDING, embeddingHandler);

    const storingHandler = new StoringHandler(
      this.repositories.sotRepository,
      this.repositories.qdrantRepository,
      this.repositories.metadataRepository
    );
    stateMachine.registerHandler(InternalStage.STORING, storingHandler);
  }

  /**
   * 功能 (What): 处理状态变化事件
   * 输入 (Input): 任务上下文和新状态
   * 输出 (Output): 无
   * 副作用 (Side-effects): 调用进度回调，发送Worker消息，更新ProgressUpdater
   */
  private handleStateChange(context: TaskContext, stage: InternalStage): void {
    const now = Date.now();
    const frontendState = IngestionStateMachine.createFrontendState(context, stage);
    const progress = frontendState.progress;

    // 节流：250毫秒内且进度值相同时不更新
    if (
      stage !== InternalStage.COMPLETED &&
      stage !== InternalStage.FAILED &&
      stage !== InternalStage.DUPLICATE
    ) {
      if (now - this.lastProgressUpdateTimestamp < 250 && progress === this.lastReportedProgress) {
        return; // 跳过更新
      }
    }

    this.lastProgressUpdateTimestamp = now;
    this.lastReportedProgress = progress;

    try {
      // 更新主进程轮询使用的摄取进度读模型。
      this.updateIngestionProgressStore(stage, context, frontendState);

      // 调用进度回调
      if (this.progressCallback) {
        this.progressCallback(
          stage,
          frontendState.progress,
          frontendState.message,
          frontendState.error
        );
      }

      // 发送Worker消息（如果在Worker环境中）
      this.sendWorkerMessage(context, stage, frontendState);
    } catch (error) {
      logger.error(`[StateMachineManager] 状态变化处理失败:`, error);
    }
  }

  /**
   * 功能 (What): 将状态机状态投影到摄取进度读模型
   * 输入 (Input): 内部状态、任务上下文、前端状态对象
   * 输出 (Output): 无
   * 副作用 (Side-effects): 更新 IngestionProgressStore
   */
  private updateIngestionProgressStore(
    stage: InternalStage,
    context: TaskContext,
    frontendState: IngestionFrontendState
  ): void {
    try {
      // 🔥 重构修复：使用权威的状态映射，移除重复的switch逻辑
      const status = frontendState.status; // 直接使用createFrontendState()的结果
      const message = frontendState.message; // 直接使用createFrontendState()的消息

      // 规范化 stage：仅允许 parsing/embedding/storing/completed；其余为空字符串
      const rawStage = frontendState.stage;
      const normalizedStage =
        rawStage === 'parsing' ||
        rawStage === 'embedding' ||
        rawStage === 'storing' ||
        rawStage === 'completed'
          ? rawStage
          : '';
      const progress =
        typeof frontendState.progress === 'number' ? frontendState.progress : undefined;
      const stageProgress =
        typeof frontendState.stage_progress === 'number' ? frontendState.stage_progress : undefined;

      updateIngestionProgress(context.docId, {
        doc_id: context.docId,
        filename: context.filename,
        status,
        message,
        error: status === 'failed' ? frontendState.error || message : undefined,
        updated_at: Date.now(),
        progress,
        stage: normalizedStage,
        stage_progress: stageProgress,
      });
    } catch (error) {
      logger.error('[StateMachineManager] 摄取进度存储更新失败:', error);
    }
  }

  /**
   * 功能 (What): 发送Worker消息
   * 输入 (Input): 上下文、状态、前端状态对象
   * 输出 (Output): 无
   * 副作用 (Side-effects): 向主线程发送进度消息
   */
  private sendWorkerMessage(
    context: TaskContext,
    stage: InternalStage,
    frontendState: IngestionFrontendState
  ): void {
    try {
      // 动态导入worker_threads，这样在主进程中不会出错
      const { parentPort, isMainThread } = require('worker_threads');

      if (parentPort) {
        // ✅ 在Worker中：只负责向主进程发送消息
        let message;
        if (stage === InternalStage.COMPLETED) {
          message = {
            type: 'completed',
            taskId: context.taskId,
            result: {
              success: true,
              docId: context.docId,
              frontendState,
              storeResult: context.storeResult,
            },
          };
        } else if (stage === InternalStage.FAILED) {
          message = {
            type: 'failed',
            taskId: context.taskId,
            error: context.errorMessage || frontendState.error || '未知错误',
          };
        } else if (stage === InternalStage.DUPLICATE) {
          message = {
            type: 'completed',
            taskId: context.taskId,
            result: {
              success: true,
              duplicate: true,
              docId: context.docId,
              frontendState,
            },
          };
        } else {
          // 进度更新消息
          message = {
            type: 'progress',
            taskId: context.taskId,
            frontendState,
          };
        }
        parentPort.postMessage(message);
      } else if (isMainThread) {
        // ✅ 在主进程中（当不使用Worker时）：直接向渲染进程推送状态更新
        this.sendIpcStatusUpdate(context, stage, frontendState);
      }
    } catch (error) {
      // 如果导入'worker_threads'失败，说明不在Worker环境中，
      // 这时也应该尝试调用IPC更新，因为可能在主进程中运行（非Worker模式）。
      this.sendIpcStatusUpdate(context, stage, frontendState);
    }
  }

  /**
   * 功能 (What): 通过IPC向前端推送状态更新（🔥 已统一到QueueManager，此路径已禁用）
   * 输入 (Input): 任务上下文、内部状态、前端状态
   * 输出 (Output): 无
   * 副作用 (Side-effects): 🔥 重构修复：为避免双重推送，此方法已禁用，统一由QueueManager负责IPC推送
   */
  private sendIpcStatusUpdate(
    context: TaskContext,
    stage: InternalStage,
    frontendState: IngestionFrontendState
  ): void {
    try {
      if (!this.statusUpdatePublisher) {
        return;
      }
      this.statusUpdatePublisher({
        taskId: context.taskId,
        docId: context.docId,
        filename: context.filename,
        stage,
        errorMessage: context.errorMessage,
        frontendState,
        storeResult: context.storeResult,
      });
    } catch (error) {
      // 在非Electron环境中或发送失败时静默处理
      logger.debug(
        `[StateMachineManager] 非Worker模式IPC兜底推送失败（可能在非Electron环境）: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * 功能 (What): 执行完整的文档摄入流程
   * 输入 (Input): 摄入任务参数
   * 输出 (Output): 最终的状态转换结果
   * 副作用 (Side-effects): 执行完整的状态机流程，从PENDING到终态
   */
  async processDocument(params: IngestionTaskParams): Promise<StateTransitionResult> {
    logger.info(
      `[StateMachineManager] 开始处理文档: ${params.filename} (任务ID: ${params.taskId})`
    );

    try {
      // 创建并设置初始状态
      const initialState = createIngestionProgressSnapshot(
        params.docId,
        params.filename,
        'pending',
        '等待处理'
      );
      updateIngestionProgress(params.docId, initialState);
      logger.info(`[StateMachineManager] 初始状态已设置: ${params.docId}`);

      // 创建初始任务上下文
      const initialContext = createInitialContext({
        taskId: params.taskId,
        docId: params.docId,
        kbId: params.kbId,
        filename: params.filename,
        filePath: params.filePath,
        embeddingModelId: params.embeddingModelId,
        pdfOcrModelId: params.pdfOcrModelId,
        imageVisionModelId: params.imageVisionModelId,
        visionModelId: params.visionModelId,
        rerankModelId: params.rerankModelId,
        forceVisionMode: params.forceVisionMode, // 🔥 修复：传递强制视觉模式参数
      });

      logger.info(`[StateMachineManager] 初始上下文创建完成，开始状态机流程`);

      // 运行状态机
      const result = await this.stateMachine.run(initialContext);

      // 记录最终结果
      if (result.success) {
        logger.info(
          `[StateMachineManager] 文档处理成功: ${params.filename}, 最终状态: ${result.newStage}`
        );
      } else {
        logger.error(
          `[StateMachineManager] 文档处理失败: ${params.filename}, 错误: ${result.error}`
        );
      }

      return result;
    } catch (error) {
      const errorMessage = `状态机管理器处理失败: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[StateMachineManager] ${errorMessage}`, error);

      // 返回失败结果
      return {
        success: false,
        newStage: InternalStage.FAILED,
        context: createInitialContext(params),
        error: errorMessage,
      };
    }
  }

  /**
   * 功能 (What): 获取状态机的当前统计信息
   * 输入 (Input): 无
   * 输出 (Output): 状态机统计对象
   * 副作用 (Side-effects): 无
   */
  getStatistics(): IngestionStateMachineStatistics {
    return {
      registeredHandlers: [
        InternalStage.PENDING,
        InternalStage.PARSING,
        InternalStage.EMBEDDING,
        InternalStage.STORING,
      ],
      managerVersion: '1.0.0',
      architecture: 'state-machine',
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * 功能 (What): 验证任务参数
   * 输入 (Input): 任务参数
   * 输出 (Output): 验证结果对象
   * 副作用 (Side-effects): 无
   */
  static validateTaskParams(params: IngestionTaskParams): { isValid: boolean; error?: string } {
    const requiredFields: (keyof IngestionTaskParams)[] = [
      'taskId',
      'docId',
      'kbId',
      'filename',
      'filePath',
      'embeddingModelId',
    ];

    for (const field of requiredFields) {
      if (!params[field]) {
        return { isValid: false, error: `缺少必需的参数: ${field}` };
      }
    }

    // 验证文件路径格式
    if (typeof params.filePath !== 'string' || params.filePath.length === 0) {
      return { isValid: false, error: '文件路径无效' };
    }

    // 验证模型ID格式
    if (typeof params.embeddingModelId !== 'string' || params.embeddingModelId.length === 0) {
      return { isValid: false, error: '向量化模型ID无效' };
    }

    return { isValid: true };
  }

  /**
   * 功能 (What): 初始化状态机管理器系统
   * 输入 (Input): 线程池实例
   * 输出 (Output): 无
   * 副作用 (Side-effects): 设置全局线程池，准备摄入任务执行环境
   */
  static initialize(threadPool: unknown): void {
    logger.info('[StateMachineManager] 初始化状态机管理器系统...');

    // 存储线程池引用，供后续任务使用
    // 注意：这里我们可以将threadPool存储在静态属性中，或者进行其他必要的全局初始化
    logger.info('[StateMachineManager] 状态机管理器系统初始化完成');
  }

  /**
   * 功能 (What): 创建状态机管理器实例
   * 输入 (Input): 可选的配置选项
   * 输出 (Output): 配置好的状态机管理器实例
   * 副作用 (Side-effects): 初始化状态机和所有处理器
   */
  static create(options: StateMachineManagerOptions): IngestionStateMachineManager {
    return new IngestionStateMachineManager(options);
  }
}

// ==================== 便捷导出 ====================

/**
 * 创建并运行文档摄入流程的便捷函数
 */
export async function runDocumentIngestion(
  params: IngestionTaskParams,
  options: StateMachineManagerOptions
): Promise<StateTransitionResult> {
  const manager = IngestionStateMachineManager.create(options);
  return await manager.processDocument(params);
}

/**
 * 验证摄入任务参数的便捷函数
 */
export function validateIngestionParams(params: IngestionTaskParams): {
  isValid: boolean;
  error?: string;
} {
  return IngestionStateMachineManager.validateTaskParams(params);
}
