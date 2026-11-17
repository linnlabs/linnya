import type { ParsedContentBlock, VectorizedBlock } from '../ingestionTypes';
import type { QdrantPoint, PointPayload } from '../../infrastructure/qdrantRepository';

/** 摄入、失败页续跑与索引重建共享同一持久化投影，稳定保留引用块身份。 */
export function projectChunkPayload(docId: string, filename: string, block: ParsedContentBlock): PointPayload {
  return {
    doc_id: docId, block_id: block.id, document: block.text, doc_title: filename,
    block_type: block.block_type, page_number: block.source_info.page_num,
    para_idx: block.source_info.para_idx,
    ...(block.parent_block_id ? { parent_block_id: block.parent_block_id } : {}),
    ...(typeof block.part_index === 'number' ? { part_index: block.part_index } : {}),
    metadata: { source_info: block.source_info },
  };
}

export function projectChunkVectorPoints(docId: string, filename: string, blocks: VectorizedBlock[]): QdrantPoint[] {
  return blocks.map(block => ({
    id: block.id, vector: { default: block.vector, bm25: block.sparse_vector },
    payload: projectChunkPayload(docId, filename, block),
  }));
}
