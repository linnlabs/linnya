/**
 * @file src/agent/context/config.ts
 * @description Agent上下文构建策略配置 - Agent Provider pipeline 配置中心
 * 
 * 🎯 目的: 为Agent的ContextManager提供所有策略参数的可配置中心
 * 📖 详情: 实现 Agent README 中描述的 Provider pipeline，专注于工具交互优化
 * 🔧 特色: P1-P3优先级填充策略，工具调用配对保留机制
 */

import { Logger } from '../../../../shared/logger';
import {
  DEFAULT_PROMPT_CONTEXT_WINDOW_TOKENS,
  DEFAULT_PROMPT_MAX_OUTPUT_TOKENS,
} from '../../../../shared/prompt-budget';

const logger = new Logger('AgentContextConfig');

/**
 * Agent上下文构建器核心配置
 * 
 * 🎯 统一管理Agent专用的Token限制、触发条件和策略参数
 * 🔧 特别针对工具交互场景进行优化
 */
export const AGENT_CONTEXT_BUILDER_CONFIG = {
  // === 绝对Token限制设置 ===
  
  /** 独立 Context Manager 没有模型 route 时使用的总窗口 fallback。 */
  DEFAULT_MAX_TOKENS: DEFAULT_PROMPT_CONTEXT_WINDOW_TOKENS,
  
  /** 独立 Context Manager 没有模型 route 时使用的最大输出 fallback。 */
  RESERVED_FOR_RESPONSE: DEFAULT_PROMPT_MAX_OUTPUT_TOKENS,
  
  // === Agent专用工作记忆填充策略 ===
  
  /**
   * 工作记忆填充目标百分比
   * - **基准**: 可用上下文总预算
   * - **说明**: Agent 工作记忆层会尽力填充到此百分比
   */
  WORKING_MEMORY_BUDGET_PERCENTAGE: 0.70,
  
  // === Agent专用优先级配置 ===
  
  /**
   * P1优先级：工具交互配对保留
   * - 工具调用(tool_calls)和工具结果(tool)必须配对保留
   * - 最高优先级，确保工具交互完整性
   */
  P1_TOOL_INTERACTION_PRIORITY: 1,
  
  /**
   * P2优先级：纯文本对话
   * - 不包含工具调用的user和assistant消息
   * - 按时间倒序填充
   */
  P2_TEXT_CONVERSATION_PRIORITY: 2,
  
  /**
   * P3优先级：历史工具交互
   * - 较旧的工具调用记录
   * - 仍然需要配对保留
   */
  P3_HISTORICAL_TOOL_PRIORITY: 3,
  
  // === 工具交互特殊配置 ===
  
  /**
   * 工具调用配对搜索范围
   * - 在多少条消息范围内搜索工具调用的配对
   */
  TOOL_PAIRING_SEARCH_RANGE: 10,
  
  /**
   * 工具交互保留的最小数量
   * - 即使预算不足，也要保留最近的几组工具交互
   */
  MIN_TOOL_INTERACTIONS_TO_KEEP: 2,

  /**
   * P1：最近工具 turn 的原始 tool_calls/tool_output 保护窗口
   * - 目的：当前 turn + 最近历史 turn 内，工具 input 原样保留，避免构建期改写误导模型
   */
  MAX_RECENT_TOOL_RUNS_TO_KEEP: 2,

  /**
   * P1+P3：工作记忆层最多保留的工具交互组总数（超过则直接丢弃）
   * - 目的：对 user 之前的“历史工具交互”做硬上限，避免工具历史过长污染上下文
   * - 注意：这里的“工具交互组”既包括原始 tool_calls/tool_output 配对，也包括被预处理压缩成
   *   assistant 文本的“工具执行记录摘要”（metadata.isCompressedToolHistory === true）
   */
  MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: 12,
  
  // === 消息类型优先级定义 ===
  
  /** 核心上下文保留层消息类型 - 第一阶段 */
  CORE_MESSAGE_TYPES: ['system_prompt', 'user_input'] as const,
  
  /** P1优先级内容类型 - Agent专用 */
  P1_CONTENT_TYPES: ['tool_calls', 'tool_output'] as const,
  
  /** P2优先级内容类型 - Agent专用 */
  P2_CONTENT_TYPES: ['final_answer', 'user_input'] as const,
  
  /** P3优先级内容类型 - Agent专用 */
  P3_CONTENT_TYPES: ['historical_tool_calls', 'historical_tool_result'] as const,
  
  // === Token估算配置 ===
  
  /** 平均每个字符的token估算比例 */
  AVG_CHARS_PER_TOKEN: 2.0,
  
  /** 工具调用的额外Token开销估算 */
  TOOL_CALL_OVERHEAD_TOKENS: 50,
  
  // === 模型配置 ===
  
  /**
   * Token 精确估算用的“模型标识”（用于映射到 tiktoken encoding）
   *
   * 说明：
   * - 这里只用于默认 `TokenizerPort` 的 encoding 选择，不用于真实 LLM 调用；
   * - 为避免把某个具体业务模型写死在这里，统一使用 tiktoken 的默认 encoding：cl100k_base。
   */
  TOKEN_ENCODING_NAME: 'cl100k_base',
  
  // === 性能与调试配置 ===
  
  /** 是否启用详细的构建统计 */
  ENABLE_BUILD_STATS: true,
  
  /** 是否启用阶段执行时间统计 */
  ENABLE_TIMING_STATS: true,
  
  /** 上下文构建超时阈值 (毫秒) */
  PROCESSING_TIMEOUT_MS: 1500,
  
  /** 工具交互配对失败警告阈值 */
  TOOL_PAIRING_FAILURE_WARNING_THRESHOLD: 3,
  
};

/**
 * Agent上下文构建策略配置的类型定义
 */
export interface AgentContextBuilderConfig {
  // === 绝对Token限制设置 ===
  DEFAULT_MAX_TOKENS: number;
  RESERVED_FOR_RESPONSE: number;
  
  // === Agent专用工作记忆填充策略 ===
  WORKING_MEMORY_BUDGET_PERCENTAGE: number;
  
  // === Agent专用优先级配置 ===
  P1_TOOL_INTERACTION_PRIORITY: number;
  P2_TEXT_CONVERSATION_PRIORITY: number;
  P3_HISTORICAL_TOOL_PRIORITY: number;
  
  // === 工具交互特殊配置 ===
  TOOL_PAIRING_SEARCH_RANGE: number;
  MIN_TOOL_INTERACTIONS_TO_KEEP: number;
  MAX_RECENT_TOOL_RUNS_TO_KEEP: number;
  MAX_TOOL_INTERACTION_GROUPS_TO_KEEP: number;
  
  // === 消息类型优先级定义 ===
  CORE_MESSAGE_TYPES: readonly string[];
  P1_CONTENT_TYPES: readonly string[];
  P2_CONTENT_TYPES: readonly string[];
  P3_CONTENT_TYPES: readonly string[];
  
  // === Token估算配置 ===
  AVG_CHARS_PER_TOKEN: number;
  TOOL_CALL_OVERHEAD_TOKENS: number;
  
  // === 模型配置 ===
  TOKEN_ENCODING_NAME: string;
  
  // === 性能与调试配置 ===
  ENABLE_BUILD_STATS: boolean;
  ENABLE_TIMING_STATS: boolean;
  PROCESSING_TIMEOUT_MS: number;
  TOOL_PAIRING_FAILURE_WARNING_THRESHOLD: number;
}

/**
 * Agent专用阶段执行优先级枚举
 */
export enum AgentBuildPhase {
  /** 阶段1: 核心上下文保留层 */
  CORE_CONTEXT = 1,
  
  /** 阶段2: 工作记忆填充层 (P1-P4优先级) */
  WORKING_MEMORY = 2
}

/**
 * Agent专用消息优先级枚举
 */
export enum AgentMessagePriority {
  /** P1: 工具交互 - 最高优先级 */
  TOOL_INTERACTION = 1,
  
  /** P2: 纯文本对话 - 高优先级 */
  TEXT_CONVERSATION = 2,
  
  /** P3: 历史工具交互 - 中优先级 */
  HISTORICAL_TOOL = 3,
  
  /** P4: 循环填充 - 低优先级 */
  CIRCULAR_FILL = 4
}

/**
 * Agent上下文构建统计接口
 */
export interface AgentContextBuildStats {
  /** 构建开始时间 */
  startTime: number;
  
  /** 各阶段执行时间 */
  phaseTiming: Record<AgentBuildPhase, number>;
  
  /** 各阶段token使用情况 */
  phaseTokenUsage: Record<AgentBuildPhase, { used: number; percentage: number }>;
  
  /** 消息数量统计 */
  messageStats: {
    original: number;
    afterCoreContext: number;
    afterWorkingMemory: number;
  };
  
  /** 优先级处理统计 */
  priorityStats: {
    p1ToolInteractions: number;
    p2TextConversations: number;
    p3HistoricalTools: number;
    p4CircularFill: number;
  };
  
  /** 工具交互统计 */
  toolStats: {
    totalToolCalls: number;
    pairedToolCalls: number;
    unpairedToolCalls: number;
    toolPairingSuccessRate: number;
  };
  
  /** 文档片段是否被截断 */
  documentTruncated: boolean;
  
  /** 总构建时间 */
  totalTime: number;
}

/**
 * 创建自定义Agent上下文构建配置的辅助函数
 */
export function createAgentContextBuilderConfig(
  overrides: Partial<AgentContextBuilderConfig>
): AgentContextBuilderConfig {
  return {
    ...AGENT_CONTEXT_BUILDER_CONFIG,
    ...overrides
  } as AgentContextBuilderConfig;
}

// 已移除预算自适应逻辑，统一使用 AGENT_CONTEXT_BUILDER_CONFIG

/**
 * 获取Agent可用Token预算的辅助函数
 */
export function getAgentAvailableTokenBudget(totalBudget?: number): number {
  const budget = totalBudget || AGENT_CONTEXT_BUILDER_CONFIG.DEFAULT_MAX_TOKENS;
  return Math.max(0, budget - AGENT_CONTEXT_BUILDER_CONFIG.RESERVED_FOR_RESPONSE);
}

/**
 * 检查工具交互是否需要配对保留
 */
export function shouldPairToolInteraction(
  messageRole: string,
  hasToolMetadata: boolean
): boolean {
  return (messageRole === 'assistant' && hasToolMetadata) || messageRole === 'tool';
}

/**
 * 验证Agent配置有效性的辅助函数
 */
export function validateAgentConfig(config: AgentContextBuilderConfig): boolean {
  // 检查绝对Token限制
  if (config.DEFAULT_MAX_TOKENS <= 0) {
    logger.warn('DEFAULT_MAX_TOKENS must be positive');
    return false;
  }
  
  if (config.RESERVED_FOR_RESPONSE <= 0 || config.RESERVED_FOR_RESPONSE >= config.DEFAULT_MAX_TOKENS) {
    logger.warn('RESERVED_FOR_RESPONSE must be positive and less than DEFAULT_MAX_TOKENS');
    return false;
  }
  
  // 检查百分比配置是否合理
  if (config.WORKING_MEMORY_BUDGET_PERCENTAGE <= 0 || config.WORKING_MEMORY_BUDGET_PERCENTAGE > 1) {
    logger.warn('WORKING_MEMORY_BUDGET_PERCENTAGE should be between 0 and 1');
    return false;
  }
  
  // 检查工具相关配置
  if (config.TOOL_PAIRING_SEARCH_RANGE <= 0) {
    logger.warn('TOOL_PAIRING_SEARCH_RANGE should be positive');
    return false;
  }
  
  if (config.MIN_TOOL_INTERACTIONS_TO_KEEP < 0) {
    logger.warn('MIN_TOOL_INTERACTIONS_TO_KEEP should be non-negative');
    return false;
  }

  if (config.MAX_RECENT_TOOL_RUNS_TO_KEEP < 0) {
    logger.warn('MAX_RECENT_TOOL_RUNS_TO_KEEP should be non-negative');
    return false;
  }

  if (config.MAX_TOOL_INTERACTION_GROUPS_TO_KEEP <= 0) {
    logger.warn('MAX_TOOL_INTERACTION_GROUPS_TO_KEEP should be positive');
    return false;
  }

  if (config.AVG_CHARS_PER_TOKEN <= 0) {
    logger.warn('AVG_CHARS_PER_TOKEN should be positive');
    return false;
  }

  if (config.TOOL_CALL_OVERHEAD_TOKENS < 0) {
    logger.warn('TOOL_CALL_OVERHEAD_TOKENS should be non-negative');
    return false;
  }

  if (config.TOKEN_ENCODING_NAME.trim().length === 0) {
    logger.warn('TOKEN_ENCODING_NAME should not be empty');
    return false;
  }
  
  return true;
}

/**
 * 获取Agent默认Token配置
 */
export function getAgentDefaultTokenConfig(): {
  maxTokens: number;
  reservedForResponse: number;
  availableForContext: number;
  workingMemoryBudget: number;
} {
  const config = AGENT_CONTEXT_BUILDER_CONFIG;
  const availableForContext = getAgentAvailableTokenBudget();
  
  return {
    maxTokens: config.DEFAULT_MAX_TOKENS,
    reservedForResponse: config.RESERVED_FOR_RESPONSE,
    availableForContext,
    workingMemoryBudget: Math.floor(availableForContext * config.WORKING_MEMORY_BUDGET_PERCENTAGE)
  };
}
