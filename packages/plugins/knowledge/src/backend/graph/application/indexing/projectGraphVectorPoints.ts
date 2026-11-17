import { generateGraphVectorPointId } from '../../../ingestion/functions/knowledgeVectorPointIdentity';
import type {
  KnowledgeGraphNodeRecord,
  KnowledgeGraphEdgeRecord,
} from '../../infrastructure/knowledgeGraphRepository';

function buildNodeText(name: string, description: string | null): string {
  const desc = typeof description === 'string' ? description.trim() : '';
  return desc.length > 0 ? `${name}\n${desc}` : name;
}

function buildEdgeText(statement: string | null, fallback: string): string {
  const s = typeof statement === 'string' ? statement.trim() : '';
  if (s.length > 0) return s;

  /**
   * statement 在 schema 中是可选字段（历史抽取/某些 LLM 输出可能缺失）。
   * 这里用“结构化三元组”作为退化文本，保证边仍可被向量检索召回。
   */
  return fallback;
}

export function projectGraphVectorPoints(
  kbId: string,
  nodes: KnowledgeGraphNodeRecord[],
  edges: KnowledgeGraphEdgeRecord[]
) {
  const nodePoints = nodes.map(n => ({
    // 根因修复：Qdrant point id 必须是 UUID/无符号整数；图谱 node.id 可能是普通字符串
    id: generateGraphVectorPointId(kbId, 'kg_node', n.id),
    blockId:
      typeof n.sourceBlockId === 'string' && n.sourceBlockId.trim().length > 0
        ? n.sourceBlockId
        : n.id,
    text: buildNodeText(n.name, n.description),
    metadata: {
      kb_id: kbId,
      kind: 'kg_node',
      node_id: n.id,
      name: n.name,
      canonical_name: n.canonicalName,
      type: n.type,
      description: n.description,
      source_doc_id: n.sourceDocId,
      source_block_id: n.sourceBlockId,
    },
  }));

  const edgePoints = edges.map((e) => ({
      // 根因修复：Qdrant point id 必须是 UUID/无符号整数；图谱 edge.id 可能是 edge_xxx 这类字符串
      id: generateGraphVectorPointId(kbId, 'kg_edge', e.id),
      blockId: typeof e.evidenceBlockId === 'string' && e.evidenceBlockId.trim().length > 0 ? e.evidenceBlockId : e.id,
      text: buildEdgeText(e.statement, `${e.sourceEntityId} ${e.relationType} ${e.targetEntityId}`),
      metadata: {
        kb_id: kbId,
        kind: 'kg_edge',
        edge_id: e.id,
        source_entity_id: e.sourceEntityId,
        target_entity_id: e.targetEntityId,
        relation_type: e.relationType,
        statement: e.statement,
        confidence: e.confidence,
        sentiment: e.sentiment,
        time: e.time,
        evidence_doc_id: e.evidenceDocId,
        evidence_block_id: e.evidenceBlockId,
      },
    }));

  return { nodePoints, edgePoints };
}
