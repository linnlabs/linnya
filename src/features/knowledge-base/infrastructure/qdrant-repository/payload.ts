/**
 * @file src/features/knowledge-base/infrastructure/qdrant-repository/payload.ts
 *
 * @brief 将 Qdrant payload 收敛成领域层 PointPayload（严格校验）
 */

import type { PointPayload } from '../qdrantRepository';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * 功能：将适配器层返回的 payload（Record<string, unknown>）严格转换为领域所需的 PointPayload。
 *
 * 说明：
 * - 这是仓储边界的类型收敛点：禁止不安全类型断言。
 * - 字段缺失时直接抛错，避免静默产生脏数据。
 */
export function toPointPayload(payload: Record<string, unknown>): PointPayload {
  const docId = payload['doc_id'];
  const blockId = payload['block_id'];
  const document = payload['document'];
  const docTitle = payload['doc_title'];
  const blockType = payload['block_type'];

  if (typeof docId !== 'string' || docId.trim().length === 0) {
    throw new Error('Qdrant payload 缺少 doc_id');
  }
  if (typeof blockId !== 'string' || blockId.trim().length === 0) {
    throw new Error('Qdrant payload 缺少 block_id');
  }
  if (typeof document !== 'string') {
    throw new Error('Qdrant payload 缺少 document');
  }
  if (typeof docTitle !== 'string' || docTitle.trim().length === 0) {
    throw new Error('Qdrant payload 缺少 doc_title');
  }
  if (typeof blockType !== 'string' || blockType.trim().length === 0) {
    throw new Error('Qdrant payload 缺少 block_type');
  }

  const result: PointPayload = {
    doc_id: docId,
    block_id: blockId,
    document,
    doc_title: docTitle,
    block_type: blockType
  };

  const pageNumber = payload['page_number'];
  if (typeof pageNumber === 'number' && Number.isFinite(pageNumber)) {
    result.page_number = pageNumber;
  }

  const paraIdx = payload['para_idx'];
  if (typeof paraIdx === 'number' && Number.isFinite(paraIdx)) {
    result.para_idx = paraIdx;
  }

  const tableId = payload['table_id'];
  if (typeof tableId === 'string' && tableId.trim().length > 0) {
    result.table_id = tableId;
  }

  const rowIdx = payload['row_idx'];
  if (typeof rowIdx === 'number' && Number.isFinite(rowIdx)) {
    result.row_idx = rowIdx;
  }

  const metadata = payload['metadata'];
  if (isRecord(metadata)) {
    result.metadata = metadata;
  }

  return result;
}


