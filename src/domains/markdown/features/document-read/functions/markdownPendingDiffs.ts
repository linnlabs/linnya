/**
 * @file markdownPendingDiffs.ts
 * @description Workspace DocumentView 的 pendingDiffs 构建器（纯函数）
 *
 * 目标：
 * - 将 pending revisions 投影为 DocumentView 的精简 diff
 * - 该模块不触达 DB，只接收 pendings + baseBlocks，返回精简 diff 信息
 */

import type { FlattenedBlock } from '@app/schemas';
import { computePlainTextDiff, type TextDiffSegment } from '../../../../../shared/utils/diffUtils';
import { maskMarkdownCitationTokens } from '../../../../citation';
import type { MarkdownPendingRevisionLike } from '../../pending-revisions';

/**
 * 单个 pending 修订对应的「精简 diff 信息」。
 *
 * 设计目标：
 * - 正文中的 base 文本已经在 observation 的 DocumentView 中展示，无需在 diff 中重复；
 * - 这里仅额外提供：
 *   - operation：update / insert / delete；
 *   - newText：该块在本次修订中的完整目标文本（update/insert 时）；
 *   - segments：仅保留 insert/delete 片段，帮助 Agent 理解“改了哪些字”，不重复 equal 片段。
 */
export type BlockPendingDiff = {
  /** 受影响的块短引用 ID（[#ref]，用于定位） */
  ref: string;
  /** 修订类型 */
  operation: 'update' | 'insert' | 'delete';
  /** 新文本（pending.new_markdown；delete 时通常为空字符串） */
  newText: string;
  /** 纯文本级 diff 片段列表，仅包含 insert/delete，不包含 equal 片段 */
  segments: TextDiffSegment[];
};

/**
 * 基于 baseBlocks 生成 pendingDiffs。
 *
 * 规则与原 Tool 保持一致：
 * - meta_json 解析失败的记录直接跳过
 * - op 默认为 update，仅当 meta.operation=insert/delete 时识别
 * - insert 的 base 文本视为 ''；delete 的 new 文本视为 ''
 * - diff 过滤掉 equal，只保留 insert/delete 片段
 * - 如果 new/base 完全相同则跳过（避免噪音）
 */
export function buildMarkdownPendingDiffs(params: {
  baseBlocks: FlattenedBlock[];
  pendings: readonly MarkdownPendingRevisionLike[];
}): BlockPendingDiff[] {
  const { baseBlocks, pendings } = params;

  const pendingDiffs: BlockPendingDiff[] = [];

  for (const rev of pendings) {
    let metaForRev: Record<string, unknown> = {};
    if (rev.meta_json) {
      try {
        metaForRev = JSON.parse(rev.meta_json) as Record<string, unknown>;
      } catch {
        // meta 解析失败时跳过该条记录
        continue;
      }
    }

    const opRaw = metaForRev.operation;
    const op: 'update' | 'insert' | 'delete' =
      opRaw === 'insert' || opRaw === 'delete' ? opRaw : 'update';

    // 统一基于 baseBlocks 查找目标块
    const baseEntry = baseBlocks.find((b) => b.blockId === rev.target_block_id);
    if (!baseEntry) {
      continue;
    }

    const ref = baseEntry.ref;
    // pendingDiffs 是旁路详情，不具备正文窗口的 citation metadata。这里仅保留“发生了引用变化”
    // 的语义，禁止让可直接引用的 ref 绕过 read_file 正文窗口进入模型上下文。
    const baseTextForDiff = op === 'insert' ? '' : maskMarkdownCitationTokens(baseEntry.text);
    const newTextForDiff = op === 'delete'
      ? ''
      : maskMarkdownCitationTokens(rev.new_markdown ?? '');

    // 计算块级 diff：先拿到完整 diff，再过滤掉 equal 片段，仅保留 insert/delete。
    const rawSegments = computePlainTextDiff(baseTextForDiff, newTextForDiff);
    const segments = rawSegments.filter(s => s.type === 'insert' || s.type === 'delete');

    // 如果没有任何实际变更片段（例如完全相同的文本），则跳过该 pending 的 diff 输出
    if (segments.length === 0 && newTextForDiff === baseTextForDiff) {
      continue;
    }

    pendingDiffs.push({
      ref,
      operation: op,
      newText: newTextForDiff,
      segments
    });
  }

  return pendingDiffs;
}
