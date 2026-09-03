/**
 * @file src/app-hosts/linnya/agent-registry/agents/deep_research/deepResearch.enricher.ts
 * @description Deep Research 请求增强器（ResearchScope 注入：research.instanceId）
 *
 * 中文备注（为什么放在 agent-registry/agents 下）：
 * - 这是“某一类 agent 的运行时注入逻辑”，属于 agent 集成的一部分；
 * - 不应该单独变成一个 features/deep-research 模块（未来每个复杂 agent 都建一个 feature 会失控）。
 */

import type { AgentInvocationRequest } from '@linnlabs/linnkit/ports';
import type { enrichment } from '@linnlabs/linnkit/runtime-kernel';
import { PromptKeys } from '../../prompt.types';
import { generateRunId } from '@linnlabs/linnkit/contracts';
import { Logger } from 'src/shared/logger';

const logger = new Logger('DeepResearchRequestEnricher');

type RequestEnricher = enrichment.RequestEnricher;
type EnrichmentContext = enrichment.EnrichmentContext;
type EnrichmentResult = enrichment.EnrichmentResult;

type DbLike = {
  prepare: (sql: string) => { get: (...args: unknown[]) => unknown; run: (...args: unknown[]) => { changes?: number } };
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function readNonEmptyString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
}

function requireDb(depsDatabaseService: unknown): DbLike {
  if (!depsDatabaseService || typeof depsDatabaseService !== 'object') {
    throw new Error('[DeepResearchRequestEnricher] deps.databaseService 无效（不是对象）');
  }
  const rec = depsDatabaseService as Record<string, unknown>;
  const getDb = rec['getDb'];
  if (typeof getDb !== 'function') {
    throw new Error('[DeepResearchRequestEnricher] deps.databaseService 缺少 getDb()');
  }
  /**
   * 根因修复：
   * - databaseService.getDb 在实现上通常依赖 this（例如 this.db / this.instance）；
   * - 若把方法引用取出来直接调用，会丢失 this 绑定，导致运行时报：
   *   "Cannot read properties of undefined (reading 'db')"
   * - 因此必须用 .call(depsDatabaseService) 保持 this 正确。
   */
  const db = (getDb as unknown as (this: unknown) => unknown).call(depsDatabaseService);
  if (!db || typeof db !== 'object') {
    throw new Error('[DeepResearchRequestEnricher] getDb() 返回无效 db');
  }
  const dbRec = db as Record<string, unknown>;
  const prepare = dbRec['prepare'];
  if (typeof prepare !== 'function') {
    throw new Error('[DeepResearchRequestEnricher] db.prepare 不存在');
  }
  return db as unknown as DbLike;
}

function isDeepResearchPromptKey(promptKey: unknown): promptKey is string {
  if (typeof promptKey !== 'string') return false;
  return (
    promptKey === PromptKeys.DEEP_RESEARCH_LEADER ||
    promptKey === PromptKeys.DEEP_RESEARCH_SCOUT ||
    promptKey === PromptKeys.DEEP_RESEARCH_REASONER_1 ||
    promptKey === PromptKeys.DEEP_RESEARCH_REASONER_2 ||
    promptKey === PromptKeys.DEEP_RESEARCH_CHALLENGER
  );
}

function generateResearchInstanceId(): string {
  // Research instance 是一次跨多个子 Agent 的逻辑 run，复用正式 run identity 合同。
  return generateRunId();
}

type ConversationMetadataShape = {
  mode?: string;
  deep_research?: {
    active_instance_id?: string;
  };
};

function parseConversationMetadata(raw: unknown): ConversationMetadataShape {
  if (raw === null || raw === undefined) return {};
  if (typeof raw !== 'string') {
    throw new Error('[DeepResearchRequestEnricher] conversations.metadata 类型非法（期望 string|null）');
  }
  const text = raw.trim();
  if (text.length === 0) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error('[DeepResearchRequestEnricher] conversations.metadata JSON 必须是对象');
  }
  return parsed as ConversationMetadataShape;
}

function serializeConversationMetadata(meta: ConversationMetadataShape): string {
  return JSON.stringify(meta);
}

export class DeepResearchRequestEnricher implements RequestEnricher {
  readonly name = 'DeepResearchRequestEnricher';

  constructor(private readonly databaseService: unknown) {}

  isApplicable(request: AgentInvocationRequest): boolean {
    return isDeepResearchPromptKey(request.promptKey);
  }

  async enrich(context: EnrichmentContext): Promise<EnrichmentResult> {
    const { conversationId, request, runContext } = context;

    if (!readNonEmptyString(conversationId)) {
      throw new Error('[DeepResearchRequestEnricher] conversationId 不能为空');
    }

    const db = requireDb(this.databaseService);

    // 1) 读取 conversations.metadata
    const row = db.prepare('SELECT metadata FROM conversations WHERE conversation_id = ?').get(conversationId);
    if (!isRecord(row)) {
      throw new Error(`[DeepResearchRequestEnricher] 会话不存在：conversation_id=${conversationId}`);
    }

    const meta = parseConversationMetadata(row['metadata']);
    const dr = meta.deep_research && typeof meta.deep_research === 'object' ? meta.deep_research : undefined;
    const existing = dr ? readNonEmptyString((dr as Record<string, unknown>)['active_instance_id']) : undefined;

    // 2) 生成或复用 active_instance_id
    const instanceId = existing ?? generateResearchInstanceId();
    if (!existing) {
      const next: ConversationMetadataShape = {
        ...meta,
        deep_research: {
          ...(meta.deep_research ?? {}),
          active_instance_id: instanceId,
        },
      };
      const result = db.prepare('UPDATE conversations SET metadata = ? WHERE conversation_id = ?').run(
        serializeConversationMetadata(next),
        conversationId
      );

      const changes = typeof result?.changes === 'number' ? result.changes : undefined;
      if (changes !== 1) {
        throw new Error(
          `[DeepResearchRequestEnricher] 更新 conversations.metadata 失败：conversation_id=${conversationId}, changes=${String(changes)}`
        );
      }

      logger.info('[DeepResearchRequestEnricher] Activated new research instance', {
        conversationId,
        instanceId,
        promptKey: request.promptKey,
      });
    }

    // 3) 注入 ToolContext + RunContext tags
    return {
      request,
      toolContextPatch: {
        research: { instanceId },
      },
      runContextPatch: {
        tags: {
          ...runContext.tags,
          deepResearchInstanceId: instanceId,
        },
      },
    };
  }
}
