import { v5 as uuidv5 } from 'uuid';

// 历史知识库向量身份命名空间；迁移 owner 时不能改变已有点 ID。
const DETERMINISTIC_NAMESPACE = 'f3f4a9d4-1a39-4467-b52b-7c85b6b3b5d7';

/**
 * **功能 (What):** 为“切分后的子块”生成一个稳定且合法的点ID（UUID）
 *
 * **输入 (Input / @param):**
 * @param parentBlockId - 父块ID（必须是一个稳定字符串，建议为父块的 UUID）
 * @param partIndex - 子块序号（从0开始）
 *
 * **输出 (Output / @returns):** RFC4122 UUID 字符串
 *
 * **副作用 (Side-effects):** 无副作用，纯函数
 *
 * @description
 * - 切分子块 ID 不能使用 `${parentId}#${idx}` 这类拼接字符串：Qdrant 只接受 UUID/无符号整数
 * - 这里使用 UUIDv5 保证确定性：同一父块 + 同一序号 永远生成同一 UUID
 */
export function generateSubBlockId(parentBlockId: string, partIndex: number): string {
  const parent = parentBlockId.trim();
  if (!parent) {
    throw new Error('generateSubBlockId: parentBlockId 不能为空');
  }
  if (!Number.isInteger(partIndex) || partIndex < 0) {
    throw new Error(`generateSubBlockId: partIndex 非法: ${partIndex}`);
  }

  return uuidv5(`${parent}:${partIndex}`, DETERMINISTIC_NAMESPACE);
}

/**
 * **功能 (What):** 为“图谱向量索引”生成一个稳定且合法的 Qdrant 点 ID（UUIDv5）
 *
 * **输入 (Input / @param):**
 * @param kbId - 知识库 ID
 * @param kind - 点的业务类型（节点/边），用于避免跨类型碰撞
 * @param graphId - 图谱内部 ID（例如 node.id / edge.id），可能不是 UUID，但必须稳定
 *
 * **输出 (Output / @returns):** RFC4122 UUID 字符串（Qdrant 可接受）
 *
 * **副作用 (Side-effects):** 无副作用，纯函数
 *
 * @description
 * 根因修复：
 * - 图谱内部的 node.id/edge.id 可能是 `apple` / `edge_xxx` 这类字符串；
 * - Qdrant point id 只接受 UUID 或无符号整数，直接 upsert 会触发 400 Bad Request；
 * - 因此这里用 UUIDv5 将稳定字符串映射为稳定 UUID，保证“幂等覆盖 + 合法格式”两者兼得。
 */
export function generateGraphVectorPointId(
  kbId: string,
  kind: 'kg_node' | 'kg_edge',
  graphId: string
): string {
  const k = kbId.trim();
  const g = graphId.trim();
  if (!k) throw new Error('generateGraphVectorPointId: kbId 不能为空');
  if (!g) throw new Error('generateGraphVectorPointId: graphId 不能为空');
  return uuidv5(`${k}:${kind}:${g}`, DETERMINISTIC_NAMESPACE);
}

