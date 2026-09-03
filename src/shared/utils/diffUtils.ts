/**
 * @file src/shared/utils/diffUtils.ts
 *
 * 后端通用文本 diff 工具。
 *
 * 设计目标：
 * - 只关心「纯文本级别」的插入 / 删除 / 保持不变，不关心 Markdown 语法或 ProseMirror 结构；
 * - 提供一个稳定、可复用的基础能力，供结构化文档读取计算 baseText 与 newText 的差异；
 * - 不引入任何浏览器相关依赖，纯 Node 环境可用。
 */

import DiffMatchPatch from 'diff-match-patch';

/**
 * 单个 diff 片段的类型：
 * - equal：文本在新旧版本中都存在且内容相同；
 * - insert：仅在新文本中存在的内容；
 * - delete：仅在旧文本中存在、在新文本中被删除的内容。
 */
export type TextDiffType = 'equal' | 'insert' | 'delete';

/**
 * 单个文本 diff 片段。
 *
 * 注意：
 * - 所有片段的 text 字段均为原始子串，不做任何 Markdown 解析或清洗；
 * - 调用方可以根据需要自行再做语义上的解释（例如把 `**` 看作粗体标记）。
 */
export interface TextDiffSegment {
  /** 变更类型 */
  type: TextDiffType;
  /** 片段文本内容（可能为空字符串） */
  text: string;
}

/**
 * 使用 diff-match-patch 计算两段文本的差异，返回简化后的片段列表。
 *
 * @param originalText - 旧文本（base 文本）
 * @param newText - 新文本（例如 AI 提供的 new_markdown）
 * @returns 按顺序排列的 diff 片段数组
 */
export function computePlainTextDiff(originalText: string, newText: string): TextDiffSegment[] {
  const dmp = new DiffMatchPatch();

  // 计算原始差异
  const diffs = dmp.diff_main(originalText, newText);

  // 使用 cleanupEfficiency 做一次轻度清理：
  // - 避免产生过多碎片化的片段；
  // - 又不会在整段重写时把所有内容视为“全删全插”（相对 cleanupSemantic 更温和）。
  dmp.diff_cleanupEfficiency(diffs);

  // 将 diff-match-patch 的结果映射为我们自己的结构
  const segments: TextDiffSegment[] = [];

  for (const [operation, text] of diffs as [number, string][]) {
    let type: TextDiffType;
    if (operation === -1) {
      type = 'delete';
    } else if (operation === 1) {
      type = 'insert';
    } else {
      type = 'equal';
    }

    // 保留空字符串片段，由上层调用方决定是否需要过滤
    segments.push({ type, text });
  }

  return segments;
}

