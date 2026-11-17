/**
 * @file graphExtractionService.ts
 *
 * @description
 * 软知识图谱抽取服务（Milestone 3）。
 *
 * 职责边界：
 * - 输入：一个 chunk（SoT block）文本 + 上下文（docId/blockId 等）
 * - 输出：结构化的 nodes/edges（已做 canonical 归一化 + 稳定 ID 生成）
 * - 不负责落库；落库由 repository 层完成（高内聚低耦合）
 *
 * 说明：
 * - 本服务不追求“完美抽取”，目标是稳定、可复现、可迭代；
 * - 解析边界必须严格：对 LLM 输出用 Zod 校验，非法输出直接视为失败（由 worker 决定重试策略）。
 */

import { z } from 'zod';
import crc32 from 'crc-32';

import { toCanonicalId, toCanonicalName } from './entityNormalization';
import type { KnowledgeGraphEdgeUpsertInput, KnowledgeGraphNodeUpsertInput } from '../infrastructure/knowledgeGraphRepository';
import {
  buildKnowledgeGraphExtractionBatchMessages,
} from 'src/app-hosts/linnya/agent-registry/internals/knowledge_graph_extraction/prompt';
import { dumpGraphExtractionBatchIfEnabled } from './graphExtractionDebugDump';
import type { TextGenerationMessage, TextGenerationPort } from 'src/domains/model-inference';

export type GraphChunkInput = {
  kbId: string;
  docId: string;
  blockId: string;
  text: string;
};

type ExtractedEntity = {
  name: string;
  type?: string | null;
  description?: string | null;
};

type ExtractedEdge = {
  source: string;
  target: string;
  relation_type: string;
  statement?: string | null;
  confidence?: number | null;
};

/**
 * 关系类型白名单（与 SOFT_GRAPH_PLAN.md 对齐）
 *
 * 注意：
 * - 本期不做复杂别名图谱/词典映射；
 * - 对不在白名单的 relation_type 做确定性归一到 RELATED_TO，避免类型碎片化影响后续 Planner 剪枝。
 */
const ALLOWED_RELATION_TYPES = [
  'IS_A',
  'CAUSES',
  'DEPENDS_ON',
  'OPPOSES',
  'LOCATED_AT',
  'RELATED_TO',
] as const;
type AllowedRelationType = (typeof ALLOWED_RELATION_TYPES)[number];

function normalizeRelationType(raw: string): AllowedRelationType {
  const trimmed = typeof raw === 'string' ? raw.trim() : '';
  if (trimmed.length === 0) return 'RELATED_TO';

  // 统一大小写与分隔符：works-for / works for -> WORKS_FOR（再判断是否在 allowlist）
  const normalized = trimmed
    .replace(/[\s-]+/g, '_')
    .replace(/__+/g, '_')
    .toUpperCase();

  return (ALLOWED_RELATION_TYPES as readonly string[]).includes(normalized) ? (normalized as AllowedRelationType) : 'RELATED_TO';
}

const GraphExtractionResponseSchema = z.object({
  entities: z.array(
    z.object({
      name: z.string().min(1),
      type: z.string().optional().nullable(),
      description: z.string().optional().nullable(),
    })
  ),
  edges: z.array(
    z.object({
      source: z.string().min(1),
      target: z.string().min(1),
      relation_type: z.string().min(1),
      statement: z.string().optional().nullable(),
      evidence_quote: z.string().optional().nullable(),
      confidence: z.number().min(0).max(1).optional().nullable(),
    })
  ),
});

const GraphExtractionBatchResponseSchema = z.array(
  z.object({
    chunk_id: z.string().min(1),
    entities: GraphExtractionResponseSchema.shape.entities,
    edges: GraphExtractionResponseSchema.shape.edges,
  })
);

function extractLikelyJsonArray(text: string): string {
  const start = text.indexOf('[');
  if (start === -1) {
    throw new Error('LLM 输出不包含可解析的 JSON 数组');
  }

  /**
   * 根因修复：
   * - 批量模式下，模型偶发会输出“两个 JSON 数组拼接”或在数组后追加另一段 JSON（例如重复输出）；
   * - 旧实现用 lastIndexOf(']') 会把多段数组一起切进来，导致 JSON.parse 报：
   *   Unexpected non-whitespace character after JSON ...
   *
   * 这里改为：从第一个 '[' 开始做括号配对扫描，提取“第一段完整 JSON 数组”，从源头避免拼接污染。
   */
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '[') {
      depth += 1;
      continue;
    }
    if (ch === ']') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
      continue;
    }
  }

  throw new Error('LLM 输出包含 "[" 但无法找到匹配的 "]"（JSON 数组不完整）');
}

function toUnsignedHex32(n: number): string {
  // crc-32 返回有符号 int32，这里转成 uint32 再转 hex，保证稳定
  const u = n >>> 0;
  return u.toString(16).padStart(8, '0');
}

function buildEdgeId(seed: string): string {
  return `edge_${toUnsignedHex32(crc32.str(seed))}`;
}

/**
 * canonical_signature（去重签名）
 *
 * 业务定义：
 * - 同一个 evidence block 内，LLM 可能重复输出语义等价的边（例如同一 subject/predicate/object 多次改写措辞）。
 * - 我们不希望这种重复边进入 Graph SoT（否则会放大路径评分、制造“伪证据密度”）。
 *
 * 去重维度（最小集合）：
 * - source_entity_id + relation_type + target_entity_id + evidence_doc_id + evidence_block_id
 *
 * 注意：
 * - signature 不包含 statement（因为 statement 可能只是重复改写）；
 * - signature 不包含 confidence（因为 confidence 不应改变“是否是同一条关系”的判定）。
 */
function buildCanonicalEdgeSignature(seed: string): string {
  return `sig_${toUnsignedHex32(crc32.str(seed))}`;
}

type EdgeDedupCandidate = {
  signature: string;
  edge: KnowledgeGraphEdgeUpsertInput;
};

function getRelationTypePriorityForDedup(relationType: string): number {
  // 目标：相同签名下优先保留“信息密度更高”的关系类型，RELATED_TO 最低
  if (relationType === 'RELATED_TO') return 0;
  return 1;
}

function pickBetterEdge(a: KnowledgeGraphEdgeUpsertInput, b: KnowledgeGraphEdgeUpsertInput): KnowledgeGraphEdgeUpsertInput {
  // 1) 关系类型优先级：非 RELATED_TO 优先
  const pa = getRelationTypePriorityForDedup(a.relationType);
  const pb = getRelationTypePriorityForDedup(b.relationType);
  if (pa !== pb) return pa > pb ? a : b;

  // 2) 置信度更高的优先（null 视为 0）
  const ca = typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? a.confidence : 0;
  const cb = typeof b.confidence === 'number' && Number.isFinite(b.confidence) ? b.confidence : 0;
  if (ca !== cb) return ca > cb ? a : b;

  // 3) statement 更长的优先（更可能包含细节/证据拼接）
  const la = typeof a.statement === 'string' ? a.statement.length : 0;
  const lb = typeof b.statement === 'string' ? b.statement.length : 0;
  if (la !== lb) return la > lb ? a : b;

  // 4) 最后兜底：保持稳定（a 在前）
  return a;
}

export type GraphExtractionResult = {
  nodes: KnowledgeGraphNodeUpsertInput[];
  edges: KnowledgeGraphEdgeUpsertInput[];
};

export class GraphExtractionService {
  private readonly textGeneration: TextGenerationPort;

  constructor(textGeneration: TextGenerationPort) {
    this.textGeneration = textGeneration;
  }

  /**
   * 批量抽取多个 chunk 的实体与关系（推荐：降低 LLM 调用次数，提高吞吐）
   *
   * 关键约束：
   * - 模型输出必须携带 chunk_id，用于结果归属；
   * - 我们仍然对输出做严格 JSON + Zod 校验，再进行 canonical 归一化与稳定 ID 生成；
   * - 不在此处做“补丁式兜底”：输出结构不符合预期会抛错，由 worker/队列决定重试。
   */
  async extractFromChunks(
    modelId: string,
    chunks: ReadonlyArray<GraphChunkInput>,
    limits: { maxEntitiesPerChunk: number; maxEdgesPerChunk: number }
  ): Promise<GraphExtractionResult> {
    if (chunks.length === 0) return { nodes: [], edges: [] };

    const chunkById = new Map<string, GraphChunkInput>();
    const promptChunks: Array<{ chunkId: string; text: string }> = [];
    for (const c of chunks) {
      chunkById.set(c.blockId, c);
      const text = typeof c.text === 'string' ? c.text.trim() : '';
      if (text.length === 0) continue;
      promptChunks.push({ chunkId: c.blockId, text });
    }

    // 全部为空文本：不调用 LLM
    if (promptChunks.length === 0) return { nodes: [], edges: [] };

    // 批量模式要求同一 docId（worker 的 blocks 本来就属于同一 doc）
    const docId = chunks[0].docId;
    const messages = buildKnowledgeGraphExtractionBatchMessages({
      docId,
      chunks: promptChunks,
      allowedRelationTypes: ALLOWED_RELATION_TYPES,
      limits,
    });

    const response = await this.textGeneration.generate({
      modelId,
      messages: messages.map<TextGenerationMessage>(message => {
        if (message.role === 'system') {
          return { role: 'system', content: message.content };
        }
        return {
          role: 'user',
          content: [{ type: 'text', text: message.content }],
        };
      }),
      temperature: 0,
    });
    const rawText = response.text;
    const jsonText = extractLikelyJsonArray(rawText);
    const parsed = GraphExtractionBatchResponseSchema.parse(JSON.parse(jsonText));

    // 开发者调试：可选落盘（默认关闭）
    // - 文件里包含 rawText（模型原始输出）与 parsed（解析后的 JSON 数组，含 chunk_id）
    // - 用于人工验证提示词抽取质量；确认无误后可关闭环境变量
    await dumpGraphExtractionBatchIfEnabled({
      kbId: chunks[0].kbId,
      docId,
      modelId,
      chunkIds: promptChunks.map((c) => c.chunkId),
      rawText,
      parsedJsonText: jsonText,
      parsed,
      createdAtIso: new Date().toISOString(),
    });

    // 去重与合并：最终落库仍按 node.id / edge.id 幂等 upsert
    const allNodes: KnowledgeGraphNodeUpsertInput[] = [];
    const allEdges: KnowledgeGraphEdgeUpsertInput[] = [];

    // chunk_id 必须唯一，且必须属于本次请求的集合
    const seenChunkIds = new Set<string>();
    for (const item of parsed) {
      if (seenChunkIds.has(item.chunk_id)) {
        throw new Error(`LLM 输出包含重复 chunk_id: ${item.chunk_id}`);
      }
      seenChunkIds.add(item.chunk_id);

      const chunk = chunkById.get(item.chunk_id);
      if (!chunk) {
        throw new Error(`LLM 输出包含未知 chunk_id（不在请求集合内）: ${item.chunk_id}`);
      }

      // 复用单 chunk 的规范化逻辑（保持行为一致）
      const entityByCanonicalName = new Map<string, ExtractedEntity>();
      for (const e of item.entities.slice(0, limits.maxEntitiesPerChunk)) {
        const canonicalName = toCanonicalName(e.name);
        if (canonicalName.length === 0) continue;
        if (!entityByCanonicalName.has(canonicalName)) {
          entityByCanonicalName.set(canonicalName, e);
        }
      }

      const canonicalNameToNodeId = new Map<string, string>();
      for (const [canonicalName, e] of entityByCanonicalName.entries()) {
        const nodeId = toCanonicalId(canonicalName);
        if (nodeId.length === 0) continue;
        canonicalNameToNodeId.set(canonicalName, nodeId);
        allNodes.push({
          kbId: chunk.kbId,
          id: nodeId,
          name: e.name,
          canonicalName,
          type: e.type ?? null,
          description: e.description ?? null,
          sourceDocId: chunk.docId,
          sourceBlockId: chunk.blockId,
        });
      }

      // ✅ 根因修复：同一个 evidence block 内对“等价关系边”做 canonical_signature 去重
      const bestEdgeBySignature = new Map<string, KnowledgeGraphEdgeUpsertInput>();

      for (const edge of item.edges.slice(0, limits.maxEdgesPerChunk)) {
        const sName = toCanonicalName(edge.source);
        const tName = toCanonicalName(edge.target);
        if (sName.length === 0 || tName.length === 0) continue;

        const sId = canonicalNameToNodeId.get(sName) ?? toCanonicalId(sName);
        const tId = canonicalNameToNodeId.get(tName) ?? toCanonicalId(tName);
        if (sId.length === 0 || tId.length === 0) continue;

        const relationType = normalizeRelationType(edge.relation_type);
        const statement = edge.statement ?? null;
        const statementKey = statement ? toCanonicalName(statement) : '';
        const seed = [
          chunk.kbId,
          sId,
          relationType,
          tId,
          chunk.docId,
          chunk.blockId,
          statementKey,
        ].join('|');

        const edgeRecord: KnowledgeGraphEdgeUpsertInput = {
          kbId: chunk.kbId,
          id: buildEdgeId(seed),
          sourceEntityId: sId,
          targetEntityId: tId,
          relationType,
          statement,
          confidence: edge.confidence ?? null,
          evidenceDocId: chunk.docId,
          evidenceBlockId: chunk.blockId,
        };

        const sigSeed = [sId, relationType, tId, chunk.docId, chunk.blockId].join('|');
        const signature = buildCanonicalEdgeSignature(sigSeed);
        const existing = bestEdgeBySignature.get(signature);
        bestEdgeBySignature.set(signature, existing ? pickBetterEdge(existing, edgeRecord) : edgeRecord);
      }

      for (const e of bestEdgeBySignature.values()) {
        allEdges.push(e);
      }
    }

    /**
     * 根因修复：批量模式必须“覆盖所有输入 chunk_id”，否则会出现：
     * - worker 认为该 batch 已完成（doneChunks += batchSize），但某些 chunk 实际没有产物；
     * - 后续无法识别“漏抽”的 chunk，从而永远不再重跑，导致图谱缺块且进度假完成。
     *
     * 约束来源：
     * - prompt 已明确要求：即使无信息也要返回该 chunk_id 的空数组；
     * - 这里用代码做硬校验，确保行为可依赖。
     */
    if (seenChunkIds.size !== promptChunks.length) {
      const expected = new Set(promptChunks.map((c) => c.chunkId));
      const missing: string[] = [];
      for (const id of expected) {
        if (!seenChunkIds.has(id)) missing.push(id);
      }
      throw new Error(
        `LLM 输出未覆盖全部 chunk_id：expected=${promptChunks.length}, got=${seenChunkIds.size}, missing=${missing.slice(
          0,
          5
        ).join(',')}${missing.length > 5 ? `...(+${missing.length - 5})` : ''}`
      );
    }

    return { nodes: allNodes, edges: allEdges };
  }
}
