/**
 * @file src/app-hosts/linnya/agent-registry/utils/currentTime.ts
 *
 * @description
 * Prompt 变量注入侧的“当前时间/日期”统一工具。
 *
 * 设计目标（根因级）：
 * - 避免把精确到秒的时间注入到 system prompt 中（会导致每次请求 prompt 字符串都变化）
 * - 上游的 prompt-level cache / KV cache 依赖“prompt 文本稳定”，秒级变化会直接造成缓存失效
 * - 因此这里将 current_time 收敛到“天”（本地日期：YYYY-MM-DD）
 *
 * 注意：
 * - 使用本地日期（而不是 UTC 的 toISOString），避免用户本地跨日与 UTC 跨日不一致造成困扰
 * - 该工具只负责“字符串格式”，不负责业务时区策略（如需严格时区，应该由调用方明确传入 Date）
 */

/**
 * 将 Date 格式化为本地日历日期字符串：YYYY-MM-DD
 */
export function formatLocalDateToDayString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 获取注入到 prompt 模板变量 `current_time` 的字符串（收敛到“天”）。
 */
export function getCurrentTimeForPromptByDay(): string {
  return formatLocalDateToDayString(new Date());
}

