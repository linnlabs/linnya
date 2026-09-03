/** 读取 VFS 字符预算；非正有限数表示调用方未提供有效预算。 */
export function readPositiveInteger(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.floor(value);
}
