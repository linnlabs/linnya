/**
 * @file src/app-hosts/linnya/agent-registry/types.ts
 * @description AgentRegistry 类型定义
 *
 * 目标：
 * - 把“一个可调用的 agent/角色（promptKey）”需要的配置与扩展点收口到一个地方
 * - 让 Flow 主链路只做“调用注册中心”，而不是散落地 import/register 各种业务扩展
 *
 * 注意：
 * - 这里的 “agent” 指的是“可调用能力单元”（以 promptKey 为入口），不是 Review 的 persona（agent_id）。
 * - Review 的 persona（内置/DB）仍由 ReviewRequestEnricher 负责解析与注入（保持职责边界清晰）。
 */

import type { PromptKey } from './prompt.types';
import type { HistoryBuilderOptionsExtender } from 'src/app-hosts/linnya/adapters/flow/history-builder/history-builder-options-extender.types';
import type { AgentInvocationRequest } from '@linnlabs/linnkit/ports';
import type { AgentSpecContextPolicy } from '@linnlabs/linnkit/contracts';
import type * as contextManager from '@linnlabs/linnkit/context-manager';
import type { enrichment } from '@linnlabs/linnkit/runtime-kernel';

type RequestEnricher = enrichment.RequestEnricher;
type IAgentTask = contextManager.agentTasks.IAgentTask;

/**
 * AgentRegistry 在注册业务增强器时所需的依赖集合
 *
 * 说明：
 * - 依赖通过工厂函数传入，避免 Registry 直接耦合到具体 Service 的构造细节
 * - 后续如果需要更多依赖（如 workflowService、reviewService 等），在这里扩展即可
 */
export interface AgentRegistryDependencies {
  // 当前暂时只需要数据库服务用于构造 AgentsService（Review 用）
  // 这里用 unknown 避免引入过重的依赖链：真正用到的工厂会在实现文件中做窄化。
  // ⚠️ 不允许使用 any；unknown 是可控的类型边界。
  databaseService: unknown;
}

/**
 * Agent 配置（工具、知识库、模型）
 * 对应历史上的 agent-config.ts（已迁移到后端 AgentRegistry）中的 AgentConfig 概念
 */
export interface AgentConfiguration {
  /**
   * 可用工具白名单
   * undefined 表示无限制（使用默认全集），空数组表示禁用所有工具
   */
  availableTools?: readonly string[];

  /**
   * 是否启用工具使用
   * 默认为 true
   */
  enableTools?: boolean;

  /**
   * 默认知识库ID
   * 默认为 'default'
   */
  knowledgeBaseId?: string;

  /**
   * 默认使用的模型 ID（后端指定）
   *
   * 说明：
   * - 用于“某个 promptKey 默认由哪个模型驱动”的后端配置；
   * - 调用方如果显式传入 request/options.model_id（通常是用户在 UI 选择的模型），应覆盖该默认值；
   * - 若两者都未提供，则交给 LlmCaller 的默认选模策略兜底。
   */
  defaultModelId?: string;

  /**
   * 模型选择策略（建议使用：比 defaultModelId 更“可读”）
   *
   * 设计目标：
   * - 让每个角色的 `index.ts` 能把“默认选模规则”写清楚（例如 default=用户主模型、translation=用户辅模型）；
   * - 避免后端拍脑袋硬编码一个具体模型 id，绕过前端 `determineModelId` 的主/辅模型选择。
   *
   * 约束：
   * - `user_primary/user_auxiliary` 依赖前端在请求中显式传入 `options.model_id`；
   *   后端不会在运行期读取前端的 models store，因此这里只做“声明”，用于审计/约束/默认回退策略。
   * - `fixed` 用于确需固定模型的特例（例如工具内部子 Agent）；工具内部子 Agent
   *   不会继承父 Agent 模型，且默认禁止底层自动切模型。
   * - `inherit_parent` 只用于注册式 child run：沿用发起该子任务的父 run 模型，
   *   让通用 subagent 与用户当前选择保持一致；根 run 不解释该策略。
   */
  modelPolicy?:
    | { kind: 'user_primary' }
    | { kind: 'user_auxiliary' }
    | { kind: 'inherit_parent' }
    | { kind: 'fixed'; modelId: string }
    | { kind: 'by_capability'; capability: string }
    | { kind: 'kb_vision' }
    | { kind: 'kb_pdf_ocr'; defaultCapability?: string }
    | { kind: 'kb_image_vision' };
  
  /**
   * 偏好的模型能力（如 'tool_calling', 'reasoning' 等）
   * 用于 GenericAgentTask.getPreferredModelCapability()
   */
  preferredModelCapability?: string;

  /**
   * 当前 Agent 单次 execution 的 Graph 节点预算。
   *
   * 未声明时继承 Linnkit 的框架默认值；长任务 Agent 可以在自己的 definition 中显式放宽，
   * 但不能通过前端设置或 prompt 临时改写。
   */
  maxSteps?: number;

  /**
   * 🔥 步数收尾策略（注册式）
   *
   * 背景：
   * - maxSteps 统计 Graph 节点；同一批工具调用由一个 ToolNode 串行排空；
   * - 某些 Agent（例如 deep_search）必须在仍有 ToolNode 预算时强制调用最终工具，
   *   避免临界 LLM 才调用工具但来不及执行。
   *
   * 说明：
   * - 该配置只描述“策略意图”，具体执行由 graph-engine 解释；
   * - 未配置时沿用默认策略（LLM 无法再完成 ToolNode→LLM 闭环时强制 final answer）。
   */
  stepPolicy?: {
    /**
     * 收尾策略类型：
     * - final_answer：LLM 剩余预算不足以完成工具闭环时禁用工具并直接回答（默认）
     * - force_tools：仍能执行最终 ToolNode 时只允许指定工具，并提示模型必须立刻调用
     */
    kind: 'final_answer' | 'force_tools';
    /** 最后几步提示阈值：remainingSteps <= threshold 时注入 stepHint（默认不提示） */
    lastStepsHintThreshold?: number;
    /**
     * 当 kind=force_tools 时，临界收尾 LLM 只允许的工具白名单
     * - 该列表必须是 AgentDefinition.config.availableTools 的子集（否则会被执行层收缩）
     */
    forcedTools?: readonly string[];
  };

  /**
   * Skill 暴露策略（按 agent 配置）
   *
   * 设计目标：
   * - Skill 暴露是“模型认知能力”配置，不只是工具开关；
   * - 开启后需要同时满足：system prompt 暴露 available_skills catalog，以及 skill 工具存在。
   */
  skill?: {
    /**
     * 是否向模型暴露 Skill 能力
     *
     * 约束：
     * - true: 在 system prompt 追加极简 available_skills catalog
     * - true 时，availableTools 必须包含 `skill`，否则视为配置错误
     */
    enabled?: boolean;
    /**
     * 该 agent prompt 明确要求可调用的 Skill 名单。
     *
     * 中文说明：prompt 里点名“先学习某个 skill”时，不能只靠自然语言约定；
     * 插件 agent 必须在这里声明，平台启动时会对照插件随包 skill 资源校验。
     */
    requiredSkills?: readonly string[];
  };

  /**
   * 上下文策略（来自 linnkit AgentSpec 协议）
   *
   * 说明：
   * - host 只声明策略意图，不复制 framework 的 zod/schema；
   * - 具体装配由 AgentMessageOrchestrator 的 resolveContextPolicy 注入点完成。
   */
  contextPolicy?: AgentSpecContextPolicy;
}

/**
 * Agent 任务逻辑配置
 * 用于 GenericAgentTask 动态生成 IAgentTask
 */
export interface AgentTaskConfiguration {
  /**
   * 系统提示词构建器
   * 替代 BaseAgentTask.getSystemPrompt()
   * 
   * 如果提供，GenericAgentTask 将使用此函数构建 system prompt。
   * 如果未提供，可能需要提供 customTaskClass。
   */
  systemPromptBuilder?: (request: AgentInvocationRequest) => string;

  /**
   * 自定义 Task 类构造器
   * 用于复杂的、无法通过 GenericAgentTask 满足的场景（如需要重写 buildMessages 逻辑的 ReviewAgentTask）
   * 
   * 如果提供，Registry.getTask() 将实例化此类。
   */
  customTaskClass?: new () => IAgentTask;
  
  /**
   * 响应处理函数
   * 替代 BaseAgentTask.processResponse()
   */
  responseProcessor?: (rawResponse: string) => string;
  
  /**
   * 流式块处理函数
   * 替代 BaseAgentTask.processStreamChunk()
   */
  streamChunkProcessor?: (chunk: string) => string;
}

/**
 * 一个“可调用 agent”的统一定义
 *
 * 设计原则：
 * - 高内聚：该 agent 的 promptKey、默认模式、工具策略、扩展点都在同一处声明
 * - 低耦合：Flow/HistoryBuilder/Enrichment 只依赖 Registry 接口，不依赖业务实现
 */
export interface AgentDefinition {
  /**
   * 唯一标识（通常与 promptKey 一致，但允许未来做 alias）
   */
  id: string;

  /**
   * promptKey：决定使用哪个任务提示词 & Task 实现
   */
  promptKey: PromptKey;

  /**
   * 默认运行模式。
   *
   * 中文备注：执行链路已统一为 agent；纯文本/单轮能力通过
   * `enableTools:false` / `availableTools:[]` 表达，而不是恢复 chat 模式。
   */
  defaultMode: 'agent';

  /**
   * 说明文本（用于调试、管理台展示等）
   */
  description: string;

  /**
   * 核心配置：工具、模型、知识库
   * 🔥 新增：收编历史 agent-config 的配置能力
   */
  config?: AgentConfiguration;

  /**
   * 任务逻辑：System Prompt 构建、响应处理
   * 🔥 新增：收编 AgentTaskRegistry
   */
  task?: AgentTaskConfiguration;

  /**
   * 扩展点声明：
   * - HistoryBuilderExtender：负责从 ConversationNextRequest.options 透传业务字段到 AgentInvokeRequest
   * - RequestEnricher：负责运行时注入（DB 查询、ToolContext Patch、RunContext Patch 等）
   *
   * 重要：注册行为必须幂等（registry 层会按 name 去重）。
   */
  integrations?: {
    /**
     * 中文备注：
     * - integrations 属于“静态配置”，不应在运行期被修改；
     * - 因此这里使用 readonly 数组，允许各 Agent 用 `as const` 定义并安全复用。
     */
    historyBuilderExtenders?: ReadonlyArray<() => HistoryBuilderOptionsExtender>;
    requestEnrichers?: ReadonlyArray<(deps: AgentRegistryDependencies) => RequestEnricher>;
  };
}
