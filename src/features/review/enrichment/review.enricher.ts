/**
 * @file src/features/review/enrichment/review.enricher.ts
 * @description Review（审阅）请求增强器
 *
 * 职责：
 * - 实现 RequestEnricher 接口
 * - 替代原 ReviewExecutionContextService
 * - 将 Review 业务逻辑注入到标准 Enrichment 流程中
 */

import type { RequestEnricher, EnrichmentContext, EnrichmentResult } from '@linnlabs/linnkit/runtime-kernel';
import type { CoreInvokeRequest } from '../../../core/invoke-request.types';
import type { AgentInvokeRequest } from '../../app-hosts/linnya/context/agent/schemas';
import { AgentsService } from '../../workspace/infrastructure/sqlite/services/agents.service';
import { PromptKeys } from '@app/schemas';
import {
  getBuiltinReviewAgentConfig,
  isBuiltinReviewAgent,
  resolveBuiltinAgentPrompt
} from 'src/app-hosts/linnya/agent-registry/agents/review/builtinAgents';

export class ReviewRequestEnricher implements RequestEnricher {
  readonly name = 'ReviewRequestEnricher';

  constructor(private readonly agentsService: AgentsService) {}

  isApplicable(request: CoreInvokeRequest): boolean {
    return request.promptKey === PromptKeys.REVIEW;
  }

  async enrich(context: EnrichmentContext): Promise<EnrichmentResult> {
    /**
     * 中文备注：
     * - core 层 EnrichmentContext.request 是 CoreInvokeRequest（最小协议面）；
     * - Review enricher 在 features 层，运行时收到的实际值一定是 AgentInvokeRequest；
     * - 这里在 features 边界做安全窄化以访问 review 专属字段。
     */
    const request = context.request as AgentInvokeRequest;
    const { runContext } = context;

    const documentId = this.extractDocumentIdFromDocumentFragment(request.document_fragment);
    if (!documentId) {
      throw new Error('[ReviewRequestEnricher] 无法从 document_fragment 中解析 document_id');
    }
    const documentVersion = this.extractDocumentVersionFromDocumentFragment(request.document_fragment);
    if (documentVersion === null) {
      throw new Error('[ReviewRequestEnricher] 无法从 document_fragment 中解析 document_version');
    }

    // 1. 校验必填字段
    const agentId = this.requireNonEmptyString(request.agent_id, 'agent_id');
    const chunkIndex = this.requireNumber(request.chunk_index, 'chunk_index');
    const totalChunks = this.requireNumber(request.total_chunks, 'total_chunks');
    const reviewRunId = request.review_run_id; // 可选，但通常应该有

    // 背景/目标允许为空
    const reviewBackground = typeof request.review_background === 'string' ? request.review_background : '';
    const reviewGoal = typeof request.review_goal === 'string' ? request.review_goal : '';

    // 2. 解析角色提示词
    let resolvedAgentName: string;
    let resolvedSystemPrompt: string;
    let resolvedKnowledge: string;

    if (isBuiltinReviewAgent(agentId)) {
      const builtinConfig = getBuiltinReviewAgentConfig(agentId);
      const resolved = resolveBuiltinAgentPrompt(agentId);
      if (!builtinConfig || !resolved) {
        throw new Error(`[ReviewRequestEnricher] 无法解析系统内置审阅角色：${agentId}`);
      }
      resolvedAgentName = builtinConfig.name;
      resolvedSystemPrompt = resolved.systemPrompt;
      resolvedKnowledge = resolved.knowledge;
    } else {
      const agent = await this.agentsService.getAgentById(agentId); // 注意：这里假设 service 可能是异步的，虽然当前实现是同步
      if (!agent) {
        throw new Error(`[ReviewRequestEnricher] 找不到自定义审阅角色：${agentId}`);
      }
      if (agent.type !== 'review') {
        throw new Error(`[ReviewRequestEnricher] 角色类型不匹配（期望 review）：${agentId} 实际=${agent.type}`);
      }
      resolvedAgentName = agent.name;
      resolvedSystemPrompt = agent.systemPrompt;
      resolvedKnowledge = agent.knowledge;
    }

    // 3. 构造增强结果
    return {
      // 增强 Request：注入解析后的变量
      request: {
        ...request,
        agent_name: resolvedAgentName,
        agent_system_prompt: resolvedSystemPrompt,
        agent_knowledge: resolvedKnowledge,
        review_background: reviewBackground,
        review_goal: reviewGoal,
      },
      // 增强 ToolContext：注入工具所需的元信息
      toolContextPatch: {
        // 当前文档 ID：供 markdown_create_annotations 工具自动落库使用（模型无需传参）
        document_id: documentId,
        expected_document_version: documentVersion,
        review_run_id: reviewRunId,
        agent_id: agentId,
        // 当前角色名：供工具写入批注 author（模型无需传参）
        agent_name: resolvedAgentName,
        chunk_index: chunkIndex,
        total_chunks: totalChunks
      },
      // 增强 RunContext：将业务 ID 提升到 Trace 上下文
      runContextPatch: {
        // 如果 request 携带了 review_run_id，则将其作为本次执行链的 traceId (correlationId)
        ...(reviewRunId ? { traceId: reviewRunId } : {}),
        tags: {
          ...runContext.tags,
          reviewAgentId: agentId,
          reviewChunkIndex: chunkIndex,
          reviewTotalChunks: totalChunks,
          reviewRunId: reviewRunId // 同时放入 tags 方便查阅
        }
      }
    };
  }

  /**
   * 从 DocumentView 协议片段中解析 document_id
   *
   * 示例（document_fragment 头部）：
   * document_id: ee06bd74-e09a-410c-9090-1ac0a4cf162d
   */
  private extractDocumentIdFromDocumentFragment(fragment: unknown): string | null {
    if (typeof fragment !== 'string' || fragment.trim().length === 0) return null;
    // 取第一处匹配，避免后续内容中的同名字段干扰
    const match = fragment.match(/(?:^|\n)document_id:\s*([^\n\r]+)(?:\r?\n|$)/);
    if (!match) return null;
    const id = match[1]?.trim();
    return id && id.length > 0 ? id : null;
  }

  private extractDocumentVersionFromDocumentFragment(fragment: unknown): number | null {
    if (typeof fragment !== 'string' || fragment.trim().length === 0) return null;
    const match = fragment.match(/(?:^|\n)document_version:\s*(\d+)(?:\r?\n|$)/);
    if (!match) return null;
    const version = Number(match[1]);
    return Number.isSafeInteger(version) && version > 0 ? version : null;
  }

  private requireNonEmptyString(value: string | undefined, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`[ReviewRequestEnricher] 缺少必填字段：${fieldName}`);
    }
    return value.trim();
  }

  private requireNumber(value: number | undefined, fieldName: string): number {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      throw new Error(`[ReviewRequestEnricher] 缺少必填字段：${fieldName}`);
    }
    return value;
  }
}
