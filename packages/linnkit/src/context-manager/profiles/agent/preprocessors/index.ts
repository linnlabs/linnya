import { 
  IPreprocessor, 
  PreprocessorContext, 
  PreprocessorResult,
} from './base';
import {
  CurrentTurnMessageAssembler,
  FenceLifetimePreprocessor,
  HistoryPurificationPreprocessor,
} from '../../../shared/preprocessors';
import type { FenceRegistry } from '../../../shared/fences';
import {
  ToolHistoryCompressorPreprocessor,
  type ToolHistoryCompressorOptions,
} from './toolHistoryCompressor';
import { ToolReplayProtocolGuardPreprocessor } from './toolReplayProtocolGuard';
import type { AiMessage } from '../../../../contracts';
import { isContextProviderError } from '../../../shared/providers/base';
import { Logger } from '../../../../shared/logger';

// 重新导出公共接口
export * from './base';
export {
  CurrentTurnMessageAssembler,
  FenceLifetimePreprocessor,
  HistoryPurificationPreprocessor,
} from '../../../shared/preprocessors';
export * from './toolHistoryCompressor';
export * from './toolReplayProtocolGuard';

export interface DefaultAgentPreprocessorRegistryOptions {
  fenceRegistry?: FenceRegistry;
  toolHistory?: ToolHistoryCompressorOptions;
}

/**
 * 预处理器注册表 - 管理所有预处理器及其执行顺序
 */
export class PreprocessorRegistry {
  private preprocessors: Map<string, IPreprocessor> = new Map();

  /**
   * 注册预处理器
   */
  register(preprocessor: IPreprocessor): void {
    if (this.preprocessors.has(preprocessor.name)) {
      throw new Error(`Preprocessor with name '${preprocessor.name}' is already registered`);
    }
    this.preprocessors.set(preprocessor.name, preprocessor);
  }

  /**
   * 获取指定名称的预处理器
   */
  getPreprocessor(name: string): IPreprocessor | undefined {
    return this.preprocessors.get(name);
  }

  /**
   * 获取所有预处理器，按优先级排序
   */
  getAllPreprocessors(): IPreprocessor[] {
    return Array.from(this.preprocessors.values())
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * 获取已注册的预处理器名称列表
   */
  getRegisteredNames(): string[] {
    return Array.from(this.preprocessors.keys());
  }

  /**
   * 检查是否已注册指定预处理器
   */
  isRegistered(name: string): boolean {
    return this.preprocessors.has(name);
  }

  /**
   * 获取注册的预处理器数量
   */
  getCount(): number {
    return this.preprocessors.size;
  }
}

/**
 * 预处理管道 - 按顺序执行所有预处理器
 */
export class PreprocessorPipeline {
  private registry: PreprocessorRegistry;
  private context: PreprocessorContext;
  private readonly logger = new Logger('AgentPreprocessorPipeline');

  constructor(
    registry: PreprocessorRegistry, 
    context: PreprocessorContext = {}
  ) {
    this.registry = registry;
    this.context = context;
  }

  /**
   * 执行完整的预处理管道
   * 
   * @param messages 输入消息列表
   * @returns 预处理管道的汇总结果
   */
  async process(messages: AiMessage[]): Promise<PreprocessorPipelineResult> {
    const startTime = performance.now();
    let currentMessages = messages;
    const pipelineResults: Array<{ preprocessor: string; result: PreprocessorResult }> = [];
    const appliedStrategies = new Set<string>();

    this.debug('🚀 开始Agent预处理管道', {
      初始消息数: messages.length,
      预处理器数量: this.registry.getCount()
    });

    // 获取所有预处理器，按优先级排序
    const preprocessors = this.registry.getAllPreprocessors();

    // 按优先级顺序执行每个预处理器
    for (const preprocessor of preprocessors) {
      this.debug(`🔄 执行预处理器: ${preprocessor.name}`, {
        优先级: preprocessor.priority,
        当前消息数: currentMessages.length
      });

      try {
        // 检查是否应该跳过
        if (preprocessor.shouldSkip?.(currentMessages, this.context)) {
          this.debug(`⏭️ 跳过预处理器: ${preprocessor.name}`, {});
          continue;
        }

        // 执行预处理
        const result = await preprocessor.process(currentMessages, this.context);
        
        // 记录结果
        pipelineResults.push({
          preprocessor: preprocessor.name,
          result
        });

        // 更新消息列表以供下一个预处理器使用
        currentMessages = result.messages;
        
        // 收集应用的策略
        result.appliedStrategies.forEach((strategy: string) => appliedStrategies.add(strategy));

        this.debug(`✅ 预处理器完成: ${preprocessor.name}`, {
          输入消息: result.stats.originalCount,
          输出消息: result.stats.processedCount,
          移除消息: result.stats.removedCount,
          修改消息: result.stats.modifiedCount,
          应用策略: result.appliedStrategies
        });

      } catch (error) {
        this.debug(`❌ 预处理器失败: ${preprocessor.name}`, { error });
        if (isContextProviderError(error) && error.fatal) {
          throw error;
        }
        // 预处理器失败不应该中断整个管道，继续执行后续预处理器
        this.logger.warn('Agent preprocessor failed; continuing pipeline', {
          preprocessor: preprocessor.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const endTime = performance.now();
    const processingTime = endTime - startTime;

    this.debug('🏁 Agent预处理管道完成', {
      原始消息数: messages.length,
      最终消息数: currentMessages.length,
      总移除数: messages.length - currentMessages.length,
      执行时间: `${processingTime.toFixed(2)}ms`,
      应用策略: Array.from(appliedStrategies)
    });

    return {
      messages: currentMessages,
      pipelineStats: {
        originalCount: messages.length,
        finalCount: currentMessages.length,
        totalRemovedCount: messages.length - currentMessages.length,
        processingTime,
        preprocessorsExecuted: pipelineResults.length,
        appliedStrategies: Array.from(appliedStrategies)
      },
      individualResults: pipelineResults
    };
  }

  /**
   * 更新预处理上下文
   */
  updateContext(newContext: Partial<PreprocessorContext>): void {
    this.context = { ...this.context, ...newContext };
  }

  /**
   * 获取当前上下文
   */
  getContext(): PreprocessorContext {
    return { ...this.context };
  }

  /**
   * 调试日志
   */
  private debug(message: string, data?: Record<string, unknown>): void {
    if (this.context.debugMode) {
      this.logger.debug(message, data);
    }
  }
}

/**
 * 预处理管道结果接口
 */
export interface PreprocessorPipelineResult {
  /** 预处理后的消息列表 */
  messages: AiMessage[];
  
  /** 管道级别的统计信息 */
  pipelineStats: {
    originalCount: number;
    finalCount: number;
    totalRemovedCount: number;
    processingTime: number;
    preprocessorsExecuted: number;
    appliedStrategies: string[];
  };
  
  /** 各个预处理器的详细结果 */
  individualResults: Array<{
    preprocessor: string;
    result: PreprocessorResult;
  }>;
}

// ================= 默认配置 =================

/**
 * 创建默认的Agent预处理器注册表
 * 
 * 🔥 这里定义了Agent预处理管道的默认配置：
 * 1. ToolHistoryCompressorPreprocessor (toolHistoryCompression) - 工具历史保留/删除，最先执行
 * 2. ToolReplayProtocolGuardPreprocessor (toolReplayProtocolGuard) - 工具回放协议守卫，仅治理历史轮次
 * 3. HistoryPurificationPreprocessor (historyPurification) - Agent历史净化，在压缩后执行
 * 
 * 💡 未来可扩展:
 * - 新增 preprocessor 时先在 PREPROCESSOR_PRIORITY 中声明稳定阶段，再接入 registry。
 */
export function createDefaultAgentPreprocessorRegistry(
  options: DefaultAgentPreprocessorRegistryOptions = {},
): PreprocessorRegistry {
  const registry = new PreprocessorRegistry();
  
  // 注册工具历史保留预处理器 - 优先级0，最先执行
  registry.register(new ToolHistoryCompressorPreprocessor(options.toolHistory));

  // 注册工具回放协议守卫 - 压缩后、净化前执行，避免旧工具组伪装为结构化 replay
  registry.register(new ToolReplayProtocolGuardPreprocessor());
  
  // 注册Agent历史净化预处理器 - 优先级1，在压缩后执行
  // 🔥 使用共享实现，配置 Agent 模式的日志前缀
  registry.register(new HistoryPurificationPreprocessor({ logPrefix: 'Agent-HistoryPurification' }));

  if (options.fenceRegistry) {
    registry.register(new CurrentTurnMessageAssembler({ fenceRegistry: options.fenceRegistry }));
    registry.register(new FenceLifetimePreprocessor({ fenceRegistry: options.fenceRegistry }));
  }
  
  // 未来可以在这里注册更多Agent专用预处理器:
  // registry.register(new AgentToolCallValidationPreprocessor());
  // registry.register(new AgentContextOptimizationPreprocessor());
  // registry.register(new AgentDeduplicationPreprocessor());
  
  return registry;
}

/**
 * 创建默认的Agent预处理管道
 * 
 * @param context 预处理上下文配置
 * @returns 配置好的Agent预处理管道实例
 */
export function createDefaultAgentPreprocessorPipeline(
  context: PreprocessorContext = {},
  options: DefaultAgentPreprocessorRegistryOptions = {},
): PreprocessorPipeline {
  const registry = createDefaultAgentPreprocessorRegistry(options);
  return new PreprocessorPipeline(registry, context);
}
