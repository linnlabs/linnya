import type { ConversationNextRequest } from '@app/schemas';
import type { AgentInvokeRequest } from 'src/app-hosts/linnya/context/agent/contracts';
import {
  historyBuilderOptionsExtenderRegistry,
} from './history-builder/history-builder-options-extender.registry';
import { buildBaseAgentInvokeRequest } from './history-builder/build-base-agent-invoke-request';
import { ensureBuiltinHistoryBuilderExtendersRegistered } from 'src/app-hosts/linnya/agent-registry/builtin';
import type { AgentConfiguration, AgentDefinition } from 'src/app-hosts/linnya/agent-registry/types';
import { PromptKeys } from 'src/app-hosts/linnya/agent-registry/prompt.types';
import { UserQuoteSchema, type UserQuoteData } from '@app/schemas';
import { Logger } from 'src/shared/logger';
import type {
  RuntimeEvent,
  RuntimeResourceRef,
  ToolOutputEvent,
  AiMessage,
} from 'linnkit/contracts';
import { RuntimeResourceRef as RuntimeResourceRefSchema } from 'linnkit/contracts';
import { findRegisteredAgentDefinitionByPromptKey } from 'src/app-hosts/linnya/agent-registry/agentDefinitionResolver';
import { createModelFacingUserInput } from 'src/app-hosts/linnya/context/agent/userInputContext';

const logger = new Logger('HistoryBuilder');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUserInputEvent(event: unknown): event is {
  type: 'user_input';
  id?: string;
  content: string;
  raw_content?: string;
  timestamp?: number;
  attachments?: unknown[];
  metadata?: Record<string, unknown>;
} {
  if (!isRecord(event)) return false;
  if (event.type !== 'user_input') return false;
  if (typeof event.content !== 'string') return false;
  if (event.id !== undefined && typeof event.id !== 'string') return false;
  if (event.raw_content !== undefined && typeof event.raw_content !== 'string') return false;
  if (event.timestamp !== undefined && typeof event.timestamp !== 'number') return false;
  if (event.attachments !== undefined && !Array.isArray(event.attachments)) return false;
  if (event.metadata !== undefined && !isRecord(event.metadata)) return false;
  return true;
}

function parseOptionalUserQuote(value: unknown): UserQuoteData | undefined {
  return value === undefined ? undefined : UserQuoteSchema.parse(value);
}

function normalizeAvailableTools(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('[HistoryBuilder] options.availableTools 类型不符合预期：必须是 string[]');
  }
  const tools: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') {
      throw new Error('[HistoryBuilder] options.availableTools 类型不符合预期：数组元素必须是 string');
    }
    tools.push(item);
  }
  /**
   * ✅ 关键语义修正（根因）：
   * - 调用方（尤其是前端）常见会把 optional 字段序列化为 `availableTools: []`；
   * - 在本系统语义里，availableTools 表示“收缩工具白名单”（只能变少）；
   * - 若把空数组当成“显式收缩到 0 个工具”，会导致工具 schema 为空，从而出现：
   *   “我们以为 tools 发过去了，但模型完全收不到 tools，永远不发起 tool_use”。
   *
   * 约定：
   * - `availableTools: []` 等价于“未指定”（回退到 AgentRegistry 默认工具集）；
   * - 若要禁用工具，请使用 `enableTools: false`（权限语义更明确）。
   */
  return tools.length > 0 ? tools : undefined;
}

function getRecordProperty(record: Record<string, unknown> | undefined, key: string): unknown {
  if (!record) return undefined;
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function assertToolsSubset(params: {
  promptKey: string;
  requestedTools: readonly string[];
  allowedTools: readonly string[];
}): void {
  const allowed = new Set(params.allowedTools);
  for (const tool of params.requestedTools) {
    if (!allowed.has(tool)) {
      // 这里不做“静默过滤”，因为这是权限语义：传错就应当暴露出来
      throw new Error(
        `[HistoryBuilder] availableTools 非法：promptKey="${params.promptKey}" 请求工具 "${tool}" 不在 registry 允许范围内`
      );
    }
  }
}

function resolveFixedModelIdFromPolicy(policy: AgentConfiguration['modelPolicy'] | undefined): string | undefined {
  if (!policy) return undefined;
  if (policy.kind !== 'fixed') return undefined;
  const id = policy.modelId;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * 历史记录构建器类
 *
 * 功能 (What): 提供静态方法，将统一的历史记录翻译成不同模式所需的请求格式
 */
export class HistoryBuilder {
  
  // ===========================================
  // 🎯 核心公共方法：统一的请求构建
  // ===========================================

  /**
   * 构建 Agent/Chat 统一请求
   *
   * 功能 (What): 构建 GraphExecutor 需要的 AgentInvokeRequest 格式
   *
   * 输入 (Input):
   * @param conversationId - 会话ID
   * @param newEvents - 新的增量事件
   * @param historyEvents - 完整的历史事件记录
   * @param options - 请求选项
   *
   * 输出 (Output):
   * @returns AgentInvokeRequest | null - Agent 调用请求对象，如果找不到用户输入则返回 null
   *
   * 副作用 (Side-effects):
   * - 无（纯函数）
   *
   * 实现细节:
   * - 从新事件或历史记录中提取用户输入
   * - 构建完整的 AgentInvokeRequest 对象
   * - 自动补充工具配置和其他参数
   */
  static buildForAgent(
    conversationId: string,
    newEvents: RuntimeEvent[],
    historyEvents: RuntimeEvent[],
    options?: ConversationNextRequest['options']
  ): AgentInvokeRequest | null {
    // 复用现有的逻辑构建 AgentInvokeRequest
    const agentRequest = this.buildMinimalRequestFromEventsOrHistory(
      conversationId,
      newEvents,
      historyEvents,
      options
    );

    if (agentRequest) {
      /**
       * 中文备注（避免误判）：
       * - 这里的 conversationHistory 是“显式注入给 context-manager 的 AiMessage[]”（chat 模式才会用到）；
       * - agent 流程的“历史上下文”主要来自 RuntimeEvent[]（EventStore 回放），并不等价于 conversationHistory；
       * - 因此旧日志里的 historyCount=0 容易被误解成“没有历史”，实际上只是“没有显式注入 AiMessage 历史”。
       */
      const conversationHistoryCount = agentRequest.conversationHistory?.length ?? 0;
      const runtimeHistoryCount = Array.isArray(historyEvents) ? historyEvents.length : 0;
      const newEventCount = Array.isArray(newEvents) ? newEvents.length : 0;
      logger.info('[HistoryBuilder] 请求构建完成', {
        queryPreview: agentRequest.query?.slice(0, 50) ?? '',
        runtimeHistoryCount,
        conversationHistoryCount,
        newEventCount,
      });
    } else {
      logger.warn('[HistoryBuilder] Agent 模式构建失败: 未找到用户输入');
    }

    return agentRequest;
  }

  /**
   * 从事件或历史记录构建 AgentInvokeRequest
   *
   * @param conversationId - 当前会话ID
   * @param newEvents - 前端传入的新的增量事件
   * @param historyEvents - 完整的历史事件
   * @param options - 包含模型ID、上下文等信息的附加选项
   * @returns AgentInvokeRequest 对象，如果找不到用户输入则返回 null
   */
  private static buildMinimalRequestFromEventsOrHistory(
    conversationId: string,
    newEvents: RuntimeEvent[],
    historyEvents: RuntimeEvent[],
    options?: ConversationNextRequest['options']
  ): AgentInvokeRequest | null {
    /**
     * 辅助函数：从事件数组中查找最后一个用户输入
     */
    const findLastUserInput = (
      events: RuntimeEvent[],
    ): {
      id?: string;
      content: string;
      attachments?: RuntimeResourceRef[];
      metadata?: Record<string, unknown>;
    } | null => {
      const last = [...events].reverse().find((e) => isUserInputEvent(e));
      if (!last) return null;
      const timestamp = typeof last.timestamp === 'number' ? last.timestamp : Date.now();
      const rawContent = typeof last.raw_content === 'string' ? last.raw_content : last.content;
      return {
        id: last.id,
        content: createModelFacingUserInput({ rawContent, timestamp }).content,
        ...(last.attachments?.length
          ? { attachments: RuntimeResourceRefSchema.array().parse(last.attachments) }
          : {}),
        metadata: last.metadata,
      };
    };

    // 首先尝试从新事件中查找用户输入
    let lastUser = findLastUserInput(newEvents);

    // 如果新事件中没有，则从历史记录中查找
    if (!lastUser && historyEvents.length > 0) {
      lastUser = findLastUserInput(historyEvents);
    }

    // 如果还是找不到用户输入，返回 null
    if (!lastUser) {
      return null;
    }

    const resolvedPromptKey = options?.promptKey || PromptKeys.DEFAULT;

    // ✅ 收口：统一在 AgentRegistry 中注册所有 HistoryBuilder 扩展器（幂等）
    // 新增业务字段透传时，只需要在 agent-registry/builtin/builtin-agent-definitions.ts 增加定义即可。
    ensureBuiltinHistoryBuilderExtendersRegistered();

    function findAgentDefinition(promptKey: string): AgentDefinition | undefined {
      return findRegisteredAgentDefinitionByPromptKey(promptKey);
    }

    // 🔥 权威来源：工具白名单由后端 AgentRegistry 定义决定；调用方允许“收缩工具集”（只能变少，不能扩权）
    // 🔥 不再 fallback default——未注册的 key 必须直接暴露（schema 层已做枚举约束）
    const agentDef = findAgentDefinition(resolvedPromptKey);
    const requestedAvailableTools = normalizeAvailableTools(options?.availableTools);
    const enableTools =
      options?.enableTools === false ? false : (agentDef?.config?.enableTools ?? true);
    const registryAvailableTools = agentDef?.config?.availableTools;
    const availableTools = (() => {
      if (enableTools === false) {
        return undefined;
      }
      // 1) 调用方传入 availableTools：表示“收缩视图”
      if (requestedAvailableTools) {
        // registry 未声明工具上限（undefined）时：允许调用方自行收缩（仍然是“变少”）
        if (registryAvailableTools) {
          assertToolsSubset({
            promptKey: resolvedPromptKey,
            requestedTools: requestedAvailableTools,
            allowedTools: registryAvailableTools,
          });
        }
        return requestedAvailableTools;
      }
      // 2) 否则使用 registry 默认工具集
      return registryAvailableTools ? Array.from(registryAvailableTools) : undefined;
    })();

    const knowledgeBaseId =
      options?.knowledge_base_id ??
      agentDef?.config?.knowledgeBaseId;

    /**
     * 模型选择优先级（单一规则，便于排查）：
     * 1) 调用方显式传入 options.model_id（通常来自“用户选择的模型”）
     * 2) Definition.config.modelPolicy(kind='fixed')（仅用于确需固定模型的特例，必须内聚在各自 index.ts）
     * 3) 交给下游 LlmCaller 的默认选模策略（兜底）
     */
    const resolvedModelId =
      (typeof options?.model_id === 'string' && options.model_id.length > 0)
        ? options.model_id
        : resolveFixedModelIdFromPolicy(agentDef?.config?.modelPolicy);

    logger.info('[HistoryBuilder] 构建 Agent 请求参数', {
      conversationId,
      userPrompt: lastUser.content || '',
      promptKey: resolvedPromptKey,
      context_before: options?.context_before,
      context_after: options?.context_after,
      current_paragraph: options?.current_paragraph,
      document_fragment: options?.document_fragment,
      enableTools,
      availableTools,
      requestedAvailableTools,
    });

    /**
     * 对话历史（AiMessage[]）
     *
     * @note
     * “历史隔离运行不带历史”的权威决策在 FlowRunPreparationService 统一收口：
     * - history_mode='isolated' 时同时清空：
     *   1) 传入 HistoryBuilder 的 RuntimeEvent history（避免上下文从 EventStore 构建）
     *   2) options.conversationHistory（避免显式 AiMessage 历史注入）
     *
     * 因此 HistoryBuilder 保持纯翻译器职责：忠实使用 options.conversationHistory。
     */
    const conversationHistory = options?.conversationHistory ?? [];
    const metadataQuote = getRecordProperty(lastUser.metadata, 'user_quote');
    const userQuote = parseOptionalUserQuote(metadataQuote);

    const baseRequest = buildBaseAgentInvokeRequest({
      lastUserContent: lastUser.content || '',
      currentUserEventId: lastUser.id,
      currentUserAttachments: lastUser.attachments,
      promptKey: options?.promptKey,
      resolvedModelId,
      imageGenerationModelId: options?.imageGenerationModelId,
      knowledgeBaseId,
      maxSteps: agentDef?.config?.maxSteps,
      enableTools,
      availableTools,
      conversationHistory,
      contextBefore: options?.context_before,
      contextAfter: options?.context_after,
      currentBlockContent: options?.current_block_content,
      documentFragment: options?.document_fragment,
      fences: options?.fences,
      currentParagraph: options?.current_paragraph,
      documentTitle: options?.document_metadata?.title,
      documentList: options?.document_list,
      projectMetadata: options?.project_metadata,
      documentMetadata: options?.document_metadata,
      // 上游只从 user_input metadata 忠实传递本轮引用；寿命控制交给下游。
      userQuote,
      reasoningEffort: options?.reasoning_effort,
    });

    // 应用扩展器：把 feature-specific 字段注入到 AgentInvokeRequest
    return historyBuilderOptionsExtenderRegistry.apply(baseRequest, {
      resolvedPromptKey,
      options,
      lastUserMetadata: lastUser.metadata,
    });
  }

}
