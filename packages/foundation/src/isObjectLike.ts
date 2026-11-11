/** 非 null 的 object：包含数组和类实例，不包含函数；不代表通过了任何数据 schema。 */
export function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
