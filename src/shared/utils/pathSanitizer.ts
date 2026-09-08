/**
 * @file src/shared/utils/pathSanitizer.ts
 *
 * @description
 * 路径清理工具函数（统一复用，避免重复实现）。
 *
 * 使用场景：
 * - 统一 Audit 的开发诊断文件按 conversation/run 身份分目录
 * - Evidence Store 存储（evidenceStore.ts）
 * - 其他需要生成安全文件/目录名的地方
 */

/**
 * 清理路径段（用于生成安全的文件/目录名）
 *
 * 中文备注：
 * - 移除非法字符，避免跨平台路径问题（Windows/Linux/macOS）
 * - 保留：字母、数字、下划线、点、横线
 * - 空输入返回 'unknown'
 * - 可选：限制最大长度（避免路径过长）
 *
 * @param segment 原始路径段（如 conversationId、runId、stepId 等）
 * @param maxLength 可选的最大长度限制（超过则截断）
 * @returns 清理后的安全路径段
 */
export function sanitizePathSegment(segment: string, maxLength?: number): string {
  const trimmed = segment.trim();
  if (!trimmed) return 'unknown';
  const cleaned = trimmed.replace(/[^a-zA-Z0-9_.-]/g, '_');
  if (typeof maxLength === 'number' && maxLength > 0 && cleaned.length > maxLength) {
    return cleaned.slice(0, maxLength);
  }
  return cleaned;
}
