/**
 * @file qdrantCollections.ts
 *
 * @description
 * Soft Knowledge Graph 的 Qdrant collection 命名规则（M5: Graph Vectorization）。
 *
 * 设计说明：
 * - 文档 ingestion 使用 kbId 作为 collectionName（存 chunk 向量）。
 * - 图谱向量化需要独立集合，避免污染/混淆 chunk collection。
 * - 命名必须“可逆”（能从 collectionName 推回 kbId），且尽量稳定。
 */

export function getGraphNodesCollectionName(kbId: string): string {
  // 注意：kbId 本身通常是 UUID/短 ID，不包含空格；这里不做额外裁剪，保持“信息不丢失”
  return `kg_nodes_${kbId}`;
}

export function getGraphEdgesCollectionName(kbId: string): string {
  return `kg_edges_${kbId}`;
}


