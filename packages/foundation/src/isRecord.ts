/**
 * 是不是普通的键值对象：非 null、不是数组。解析外部数据（JSON、IPC、插件输入）前的第一步判断。
 *
 * 数组不算。需要同时接受数组时，写明 `Array.isArray(value) || isRecord(value)`，不要另写一个同名函数。
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
