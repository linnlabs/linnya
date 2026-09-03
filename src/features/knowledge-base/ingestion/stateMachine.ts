/**
 * @file src/knowledge-base/ingestion/stateMachine.ts
 * 
 * @brief 文档摄入状态机 - 核心架构
 * 
 * @description
 * 功能 (What): 基于状态机模式的文档摄入流程管理
 * 输入 (Input): 状态转换事件和动作
 * 输出 (Output): 状态变化和副作用执行
 * 副作用 (Side-effects): 持久化状态、更新进度、执行业务逻辑
 */

import { Logger } from 'src/shared/logger';
import { cleanupFailedDocument } from './failureCleanup';
import type { MetadataRepository } from '../infrastructure/metadataRepository';
import type { QdrantRepository } from '../infrastructure/qdrantRepository';
import type { SotRepository } from '../infrastructure/sotRepository';
import type { OriginalDocumentRepository } from '../infrastructure/originalDocumentRepository';
import type { KnowledgeGraphRepository } from '../graph/infrastructure/knowledgeGraphRepository';
import {
  FrontendStatus,
  InternalStage,
  type IngestionFrontendState,
  type StateHandler,
  type StateTransitionResult,
  type TaskContext,
} from './definitions/state';
import {
  INTERNAL_TO_FRONTEND_STATUS_MAP,
  STAGE_MESSAGES,
  STAGE_TO_PROGRESS_MAP,
  STATE_TRANSITION_RULES,
} from './definitions/stateMapping';

export {
  FrontendStatus,
  InternalStage,
  StateEvent,
  type IngestionFrontendState,
  type StateHandler,
  type StateTransitionResult,
  type TaskContext,
} from './definitions/state';
export {
  INTERNAL_TO_FRONTEND_STATUS_MAP,
  STAGE_MESSAGES,
  STAGE_TO_PROGRESS_MAP,
  STATE_TRANSITION_RULES,
} from './definitions/stateMapping';

const logger = new Logger('knowledge-base:ingestion:state-machine');

// ==================== 核心状态机类 ====================

/**
 * 功能 (What): 文档摄入状态机核心引擎
 * 输入 (Input): 任务上下文和状态转换事件
 * 输出 (Output): 状态变化和执行结果
 * 副作用 (Side-effects): 状态持久化、进度更新、业务逻辑执行
 */
export class IngestionStateMachine {
  private handlers: Map<InternalStage, StateHandler> = new Map();
  private listeners: Array<(context: TaskContext, stage: InternalStage) => void> = [];
  private metadataRepository?: MetadataRepository;
  private qdrantRepository?: QdrantRepository;
  private sotRepository?: SotRepository;
  private knowledgeGraphRepository?: KnowledgeGraphRepository;
  private originalDocumentRepository?: OriginalDocumentRepository;

  constructor(
    metadataRepository?: MetadataRepository,
    qdrantRepository?: QdrantRepository,
    sotRepository?: SotRepository,
    knowledgeGraphRepository?: KnowledgeGraphRepository,
    originalDocumentRepository?: OriginalDocumentRepository
  ) {
    this.metadataRepository = metadataRepository;
    this.qdrantRepository = qdrantRepository;
    this.sotRepository = sotRepository;
    this.knowledgeGraphRepository = knowledgeGraphRepository;
    this.originalDocumentRepository = originalDocumentRepository;
    logger.info('[StateMachine] 初始化文档摄入状态机');
  }

  /**
   * 功能 (What): 注册状态处理器
   * 输入 (Input): 状态和对应的处理器
   * 输出 (Output): 无
   * 副作用 (Side-effects): 注册处理器到状态机
   */
  registerHandler(stage: InternalStage, handler: StateHandler): void {
    this.handlers.set(stage, handler);
    logger.debug(`[StateMachine] 注册状态处理器: ${stage} -> ${handler.getName()}`);
  }

  /**
   * 功能 (What): 添加状态变化监听器
   * 输入 (Input): 监听器函数
   * 输出 (Output): 无
   * 副作用 (Side-effects): 注册监听器
   */
  addListener(listener: (context: TaskContext, stage: InternalStage) => void): void {
    this.listeners.push(listener);
  }

  /**
   * 功能 (What): 验证状态转换是否合法
   * 输入 (Input): 当前状态和目标状态
   * 输出 (Output): 是否合法的布尔值
   * 副作用 (Side-effects): 无
   */
  private isValidTransition(from: InternalStage, to: InternalStage): boolean {
    const allowedTransitions = STATE_TRANSITION_RULES[from] || [];
    return allowedTransitions.includes(to);
  }

  /**
   * 功能 (What): 执行状态转换
   * 输入 (Input): 任务上下文和当前状态
   * 输出 (Output): 状态转换结果
   * 副作用 (Side-effects): 执行业务逻辑，更新状态，通知监听器
   */
  async executeState(context: TaskContext, currentStage: InternalStage): Promise<StateTransitionResult> {
    logger.info(`[StateMachine] 执行状态: ${currentStage} (任务: ${context.taskId})`);

    // 获取状态处理器
    const handler = this.handlers.get(currentStage);
    if (!handler) {
      const error = `未找到状态 ${currentStage} 的处理器`;
      return await this.handleFailure(context, error);
    }

    try {
      // 执行状态处理器
      const result = await handler.execute(context);

      // 🔥 根本性修复：如果状态处理器返回失败，立即将失败结果向上传递给 run() 方法
      // run() 方法将调用 handleFailure() 进行清理，然后再通知监听器
      // 这可以避免监听器提前发送“失败”消息导致Worker被终止，从而跳过清理步骤
      if (!result.success) {
        logger.warn(`[StateMachine] 状态处理器 ${handler.getName()} 返回失败，将交由 run() 处理`);
        return result;
      }
      
      // 验证状态转换
      if (!this.isValidTransition(currentStage, result.newStage)) {
        const error = `非法状态转换: ${currentStage} -> ${result.newStage}`;
        return await this.handleFailure(context, error);
      }

      // 更新上下文
      result.context.lastUpdated = Date.now();
      
      // 通知监听器
      this.listeners.forEach(listener => {
        try {
          logger.info(`[StateMachine] 正在通知监听器...`);
          listener(result.context, result.newStage);
        } catch (error) {
          logger.error(`[StateMachine] 监听器执行失败:`, error);
        }
      });

      logger.info(`[StateMachine] 状态转换成功: ${currentStage} -> ${result.newStage}`);
      return result;

    } catch (error) {
      const errorMessage = `状态处理器执行失败: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`[StateMachine] ${errorMessage}`, error);
      
      return await this.handleFailure(context, errorMessage);
    }
  }

  /**
   * 功能 (What): 运行完整的状态机流程
   * 输入 (Input): 初始任务上下文
   * 输出 (Output): 最终执行结果
   * 副作用 (Side-effects): 从PENDING状态开始，执行完整的文档摄入流程
   */
  async run(initialContext: TaskContext): Promise<StateTransitionResult> {
    logger.info(`[StateMachine] 开始运行状态机流程: ${initialContext.taskId}`);
    
    let currentStage = InternalStage.PENDING;
    let context = initialContext;
    let result: StateTransitionResult;

    // 状态机主循环
    while (true) {
      result = await this.executeState(context, currentStage);
      
      if (!result.success) {
        logger.error(`[StateMachine] 状态机执行失败: ${result.error}`);
        
        // 🔥 修复：调用 handleFailure 进行失败清理，而不是直接退出
        result = await this.handleFailure(context, result.error || '未知错误');
        break;
      }

      // 更新上下文
      context = result.context;
      
      // 检查是否到达终态
      if (this.isTerminalState(result.newStage)) {
        logger.info(`[StateMachine] 到达终态: ${result.newStage}`);
        break;
      }

      // 转换到下一个状态
      currentStage = result.newStage;
    }

    logger.info(`[StateMachine] 状态机流程结束: ${context.taskId}, 最终状态: ${result.newStage}`);
    return result;
  }

  /**
   * 功能 (What): 检查是否为终态
   * 输入 (Input): 状态
   * 输出 (Output): 是否为终态的布尔值
   * 副作用 (Side-effects): 无
   */
  private isTerminalState(stage: InternalStage): boolean {
    return [
      InternalStage.COMPLETED,
      InternalStage.FAILED,
      InternalStage.DUPLICATE
    ].includes(stage);
  }

  /**
   * 功能 (What): 处理失败状态，清理三大数据源
   * 输入 (Input): 任务上下文和错误消息
   * 输出 (Output): 失败状态转换结果
   * 副作用 (Side-effects): 删除SQLite记录、Qdrant向量、SOT文件，允许重试
   */
  private async handleFailure(context: TaskContext, error: string): Promise<StateTransitionResult> {
    logger.error(`[StateMachine] 处理失败: ${context.docId} - ${error}`);
    
    try {
      logger.info(`[StateMachine] 🧹 开始调用cleanupFailedDocument清理失败文档: ${context.docId}`);
      logger.info(`[StateMachine] 🔍 repository实例状态: metadata=${!!this.metadataRepository}, qdrant=${!!this.qdrantRepository}, sot=${!!this.sotRepository}`);
      
      // 清理失败文档的三大数据源
      await cleanupFailedDocument(
        context.docId,
        context.kbId,
        this.metadataRepository,
        this.qdrantRepository,
        this.sotRepository,
        this.knowledgeGraphRepository,
        this.originalDocumentRepository
      );
      
      logger.info(`[StateMachine] ✅ cleanupFailedDocument调用完成: ${context.docId}`);
    } catch (cleanupError) {
      logger.error(`[StateMachine] ❌ cleanupFailedDocument调用失败: ${context.docId}`, cleanupError);
      logger.error(`[StateMachine] ❌ 清理错误详情: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`);
    }
    
    const failureResult = {
      success: false,
      newStage: InternalStage.FAILED,
      context: { ...context, errorMessage: error },
      error
    };
    
    // 🔥 修复：确保失败状态也触发监听器，推送到前端
    this.listeners.forEach(listener => {
      try {
        listener(failureResult.context, failureResult.newStage);
      } catch (listenerError) {
        logger.error(`[StateMachine] 失败状态监听器执行失败:`, listenerError);
      }
    });
    
    return failureResult;
  }

  /**
   * 功能 (What): 创建前端状态对象
   * 输入 (Input): 任务上下文和内部状态
   * 输出 (Output): 前端状态对象
   * 副作用 (Side-effects): 无
   */
  static createFrontendState(context: TaskContext, internalStage: InternalStage): IngestionFrontendState {
    const frontendStatus = INTERNAL_TO_FRONTEND_STATUS_MAP[internalStage];
    const baseProgress = STAGE_TO_PROGRESS_MAP[internalStage];
    
    // 🔥 重构修复：根据不同阶段的实际占比计算进度
    let totalProgress = baseProgress;
    if (frontendStatus === FrontendStatus.PROCESSING) {
      // 计算每个阶段的占比范围
      const stageRanges: Record<InternalStage, { start: number; end: number } | undefined> = {
        [InternalStage.PENDING]: undefined,
        [InternalStage.PARSING]: { start: 5, end: 85 },    // 80%占比
        [InternalStage.EMBEDDING]: { start: 85, end: 95 }, // 10%占比  
        [InternalStage.STORING]: { start: 95, end: 100 },  // 5%占比
        [InternalStage.COMPLETED]: undefined,
        [InternalStage.FAILED]: undefined,
        [InternalStage.DUPLICATE]: undefined
      };
      
      const range = stageRanges[internalStage];
      if (range) {
        // 在阶段范围内根据stageProgress计算具体进度
        const progressInStage = (context.stageProgress || 0) / 100;
        totalProgress = range.start + (range.end - range.start) * progressInStage;
      }
    }

    return {
      status: frontendStatus,
      stage: internalStage,
      progress: Math.floor(totalProgress),
      stage_progress: context.stageProgress,
      message: STAGE_MESSAGES[internalStage],
      error: context.errorMessage,
      doc_id: context.docId,
      filename: context.filename,
      updated_at: context.lastUpdated
    };
  }
}

// ==================== 工厂函数 ====================

/**
 * 功能 (What): 创建初始任务上下文
 * 输入 (Input): 任务基本信息
 * 输出 (Output): 初始化的任务上下文
 * 副作用 (Side-effects): 无
 */
export function createInitialContext(options: {
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
  forceVisionMode?: boolean;
}): TaskContext {
  return {
    ...options,
    currentProgress: 0,
    stageProgress: 0,
    lastUpdated: Date.now()
  };
}

/**
 * 功能 (What): 创建状态机实例
 * 输入 (Input): 可选的三个仓储实例
 * 输出 (Output): 配置好的状态机实例
 * 副作用 (Side-effects): 无
 */
export function createStateMachine(
  metadataRepository?: MetadataRepository,
  qdrantRepository?: QdrantRepository,
  sotRepository?: SotRepository,
  knowledgeGraphRepository?: KnowledgeGraphRepository,
  originalDocumentRepository?: OriginalDocumentRepository
): IngestionStateMachine {
  return new IngestionStateMachine(
    metadataRepository,
    qdrantRepository,
    sotRepository,
    knowledgeGraphRepository,
    originalDocumentRepository
  );
}
