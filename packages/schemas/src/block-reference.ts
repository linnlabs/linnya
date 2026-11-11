/** 块短引用的唯一字符表、编码和校验合同。哈希计算由 Node/Web Crypto 适配负责。 */
// Base62 字符集（去掉易混淆字符）
const BASE62_CHARSET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DEFAULT_REF_LENGTH = 6;
export const BLOCK_REF_PREFIX = '#';

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

export interface RefIdOptions {
  readonly length?: number;
  readonly includePrefix?: boolean;
}

/** 调用方使用精确 UTF-8 blockId 计算 SHA-256；这里不裁剪、归一化身份或读取平台环境。 */
export function refIdFromDigest(hash: Uint8Array, options: RefIdOptions = {}): string {
  const { length = DEFAULT_REF_LENGTH, includePrefix = true } = options;
  const value = hashToBase62(hash, length);
  return includePrefix ? BLOCK_REF_PREFIX + value : value;
}

/**
 * 规范化 ref（确保带前缀）
 */
export function normalizeRef(ref: string): string {
  return ref.startsWith(BLOCK_REF_PREFIX) ? ref : BLOCK_REF_PREFIX + ref;
}

/**
 * 去除 ref 前缀
 */
export function stripRefPrefix(ref: string): string {
  return ref.startsWith(BLOCK_REF_PREFIX) ? ref.slice(1) : ref;
}

/**
 * 验证 ref 格式是否合法
 */
export function isValidRef(ref: string, options: RefIdOptions = {}): boolean {
  const { length = DEFAULT_REF_LENGTH, includePrefix = true } = options;

  if (includePrefix) {
    if (!ref.startsWith(BLOCK_REF_PREFIX)) {
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
