/**
 * @file refIdGenerator.ts (前端版本)
 * @description 块引用 ID（ref）生成器 - 前端实现
 *
 * 与后端 src/tools/workspace/shared/refIdGenerator.ts 保持一致的算法
 */

// 使用 Web Crypto API 进行 SHA-256 计算
async function sha256(text: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return new Uint8Array(hashBuffer);
}

// Base62 字符集（去掉易混淆字符）
const BASE62_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DEFAULT_REF_LENGTH = 6;
const REF_PREFIX = '#';

/**
 * 从哈希值生成指定长度的 Base62 字符串
 */
function hashToBase62(hash: Uint8Array, length: number): string {
  const base = BASE62_CHARSET.length;
  let num = 0n;

  // 将哈希值转换为 BigInt
  for (let i = 0; i < Math.min(hash.length, 32); i++) {
    num = (num << 8n) | BigInt(hash[i]);
  }

  let result = '';
  while (num > 0n && result.length < length) {
    const remainder = Number(num % BigInt(base));
    result = BASE62_CHARSET[remainder] + result;
    num = num / BigInt(base);
  }

  // 如果结果不足目标长度，用哈希的后续字节补齐
  while (result.length < length) {
    const idx = hash[result.length % hash.length] % BASE62_CHARSET.length;
    result += BASE62_CHARSET[idx];
  }

  return result.slice(0, length);
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
  const { length = DEFAULT_REF_LENGTH, includePrefix = true } = options;

  // 计算 SHA-256 哈希
  const hash = await sha256(blockId);

  // 转换为 Base62
  const base62Str = hashToBase62(hash, length);

  // 添加前缀（如果需要）
  return includePrefix ? REF_PREFIX + base62Str : base62Str;
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

/**
 * 规范化 ref（确保带前缀）
 */
export function normalizeRef(ref: string): string {
  return ref.startsWith(REF_PREFIX) ? ref : REF_PREFIX + ref;
}

/**
 * 去除 ref 前缀
 */
export function stripRefPrefix(ref: string): string {
  return ref.startsWith(REF_PREFIX) ? ref.slice(1) : ref;
}

/**
 * 验证 ref 格式是否合法
 */
export function isValidRef(
  ref: string,
  options: { length?: number; includePrefix?: boolean } = {}
): boolean {
  const { length = DEFAULT_REF_LENGTH, includePrefix = true } = options;

  if (includePrefix) {
    if (!ref.startsWith(REF_PREFIX)) {
      return false;
    }
    ref = ref.slice(1);
  }

  // 检查长度
  if (ref.length !== length) {
    return false;
  }

  // 检查字符集
  for (const char of ref) {
    if (!BASE62_CHARSET.includes(char)) {
      return false;
    }
  }

  return true;
}

