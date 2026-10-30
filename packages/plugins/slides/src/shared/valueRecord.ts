/** 跨 codec 的基础对象判断；业务字段及版本规则仍由各自 schema 负责。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
