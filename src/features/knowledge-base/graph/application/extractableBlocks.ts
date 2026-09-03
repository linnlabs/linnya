/**
 * @file src/features/knowledge-base/graph/application/extractableBlocks.ts
 *
 * @description
 * 图谱抽取可处理块的筛选逻辑（供主线程队列回填、worker 抽取复用）。
 *
 * 设计目标：
 * - 高内聚：抽取“哪些 block 可抽取”的规则集中管理；
 * - 低耦合：只依赖 SoT 的领域结构，不依赖 AI/DB/队列；
 * - 可测试：单测覆盖 image/空文本过滤，避免行为漂移。
 */

import type { DocumentSoT } from '../../domain/block';

export type ExtractableBlock = { blockId: string; text: string };

/**
 * **功能 (What):** 从 SoT 中收集可用于图谱抽取的文本块
 * **输入 (Input):** DocumentSoT
 * **输出 (Output):** [{blockId,text}]（仅包含非空文本，且跳过 image）
 * **副作用 (Side-effects):** 无
 */
export function collectExtractableTextBlocks(sot: DocumentSoT): ExtractableBlock[] {
  const root = Array.isArray(sot.structure?.root) ? sot.structure.root : [];
  const out: ExtractableBlock[] = [];

  for (const blockId of root) {
    const block = sot.content_blocks[blockId];
    if (!block) {
      throw new Error(`SoT 数据不一致：root 引用的 block_id 不存在: ${blockId}`);
    }
    // 图谱抽取只处理可文本化内容：image 不处理（其 text 多为占位/alt）
    if (block.block_type === 'image') continue;
    const text = typeof block.text === 'string' ? block.text.trim() : '';
    if (text.length === 0) continue;
    out.push({ blockId, text });
  }

  return out;
}


