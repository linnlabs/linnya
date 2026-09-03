/**
 * @file markdownPreviewBlocks.ts
 * @description 将 Pending Revisions 合并到 baseBlocks，生成“预览视图”（纯函数）
 *
 * 设计目标：
 * - 让 AI 在 read 时直接看到“当前文章状态”（base + pending 的合并结果）
 * - 不依赖位置索引；块定位由 ref（由 blockId 计算）保证稳定
 * - 不做防御性“猜测修复”，只按 pending_revisions 表的真实数据合并
 */

import type { FlattenedMarkdownBlock } from '../../../shared/markdownBlockProjection';
import type { MarkdownPendingRevisionLike } from '../../pending-revisions';

/**
 * PendingRevision 旧行元数据（只用于 operation 回放）
 */
type PendingMeta = {
  operation?: 'update' | 'insert' | 'delete';
};

/**
 * 从 meta_json 解析 PendingMeta
 */
function parsePendingMeta(metaJson: string | null): PendingMeta | null {
  if (!metaJson) return null;
  try {
    const parsed: unknown = JSON.parse(metaJson);
    if (!parsed || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const operation = obj.operation;
    const op =
      operation === 'update' || operation === 'insert' || operation === 'delete'
        ? operation
        : undefined;
    return { operation: op };
  } catch {
    return null;
  }
}

/**
 * 把 pending revisions 合并到 baseBlocks，生成 previewBlocks。
 *
 * 合并规则（严格基于 pending 表）：
 * - update/insert：将目标块的 text 替换为 pending.new_markdown
 * - delete：在 preview 中移除该块
 *
 * insertEmptyBlockAfter 会先在 content_json 中创建正式空 rootBlock，因此 insert pending 的目标块
 * 必须已经存在。缺失目标块表示上游数据不一致，读取投影不能根据 anchor 猜测或补造实体。
 */
export function buildMarkdownPreviewBlocks(params: {
  baseBlocks: readonly FlattenedMarkdownBlock[];
  pendings: readonly MarkdownPendingRevisionLike[];
}): FlattenedMarkdownBlock[] {
  const { baseBlocks, pendings } = params;

  // 1) 建立 pendingByBlockId（同一块只会有一条 pending；如果未来出现多条，以最后一条为准）
  const pendingByBlockId = new Map<string, MarkdownPendingRevisionLike>();
  for (const pending of pendings) {
    pendingByBlockId.set(pending.target_block_id, pending);
  }

  // 2) 先按 base 顺序合并（覆盖 text / 删除块）
  const preview: FlattenedMarkdownBlock[] = [];

  for (const block of baseBlocks) {
    const pending = pendingByBlockId.get(block.blockId);
    if (!pending) {
      preview.push(block);
      continue;
    }

    const meta = parsePendingMeta(pending.meta_json);
    // operation 已是 pending 表的正式字段；meta_json 只服务旧行回放，不能反向覆盖正式事实。
    const op = pending.operation ?? meta?.operation;

    // 判断是否为 delete 操作：
    // 1. 正式 operation（或旧行 meta_json）明确标记为 'delete'
    // 2. new_markdown 为空字符串（delete 操作时会被强制设置为空字符串）
    // 3. 防御性检查：如果 new_markdown 为 null/undefined，也视为删除（数据异常情况）
    const isDeleteOperation =
      op === 'delete' ||
      (typeof pending.new_markdown === 'string' && pending.new_markdown.trim().length === 0) ||
      pending.new_markdown == null;

    if (isDeleteOperation) {
      // delete：预览中移除该块
      continue;
    }

    // update/insert：覆盖内容
    preview.push({
      ...block,
      text: pending.new_markdown,
    });
  }

  // 缺少正式块实体的 pending 是上游数据不一致，读取投影不猜测或补造块。
  return preview;
}
