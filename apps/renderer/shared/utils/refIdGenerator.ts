import { refIdFromDigest, normalizeRef, isValidRef } from '@app/schemas';
export { normalizeRef, stripRefPrefix, isValidRef } from '@app/schemas';
/**
 * @file refIdGenerator.ts (前端版本)
 * @description 块引用 ID（ref）生成器 - 前端实现
 *
 * 只适配 Web Crypto 与异步调用；编码规则由 @app/schemas 拥有
 */

// 使用 Web Crypto API 进行 SHA-256 计算
async function sha256(text: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

/**
 * 从 blockId 生成确定性的短引用 ID
 *
 * @param blockId - 块的 UUID
 * @param options - 生成选项
 * @returns ref（例如 `#aZ3kP9`）
 */
export async function generateRefId(
  blockId: string,
  options: { length?: number; includePrefix?: boolean } = {}
): Promise<string> {
  return refIdFromDigest(await sha256(blockId), options);
}

/**
 * 批量生成 ref
 *
 * @param blockIds - blockId 列表
 * @returns Map<blockId, ref>
 */
export async function generateRefMap(blockIds: string[]): Promise<Map<string, string>> {
  const refMap = new Map<string, string>();

  for (const blockId of blockIds) {
    const ref = await generateRefId(blockId);
    refMap.set(blockId, ref);
  }

  return refMap;
}

/**
 * 从一组候选 ID 中解析出与 ref 对应的真实 ID
 *
 * 中文说明：
 * - ref 是由（blockId / nodeId）确定性生成的短引用；
 * - 因此前端在“跨文档点击跳转”时，只要能拿到候选 id 列表，就可以在不依赖内存快照的情况下解析 ref；
 * - 该函数时间复杂度为 O(n)，但只在用户点击引用时触发，属于可接受的交互级开销。
 */
export async function resolveIdFromRef(ref: string, candidateIds: string[]): Promise<string | null> {
  const normalizedRef = normalizeRef(ref);
  if (!isValidRef(normalizedRef)) {
    return null;
  }

  for (const id of candidateIds) {
    const computed = normalizeRef(await generateRefId(id));
    if (computed === normalizedRef) {
      return id;
    }
  }

  return null;
}

