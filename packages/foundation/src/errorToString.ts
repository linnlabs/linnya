/** 原样提取 Error.message；其他值沿用 JavaScript String 转换，不提供业务占位文案。 */
export function errorToString(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
