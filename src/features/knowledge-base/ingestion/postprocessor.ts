/**
 * src/knowledge-base/ingestion/postprocessor.ts
 * 
 * 文件作用: 对解析器产生的原始块进行统一后处理，生成标准化的文档结构和向量块
 * 
 * 职责:
 * - 为块生成唯一且稳定的ID
 * - 提取标题和层次结构
 * - 构建Source of Truth文档对象
 */

import path from 'path';
import iconv from 'iconv-lite';
import { Logger } from 'src/shared/logger';
import { generateBlockId as generateDeterministicBlockId, generateSubBlockId } from 'src/shared/utils/idUtils';
import { countTextUnitsZhEn, sliceTextByUnitsZhEn } from 'src/shared/utils/textUnits';
import { BlockType, type Block, type DocumentSoT } from '../domain/block';
import type { ParsedContentBlock } from './ingestionTypes';
// import { IngestionProgressUpdater } from './progressUpdater';

const logger = new Logger('knowledge-base:ingestion:postprocessor');

/**
 * 功能 (What): 判断一个字符串是否为合法 UUID（Qdrant point id 允许的格式之一）
 * 输入 (Input / @param): 待校验字符串
 * 输出 (Output / @returns): 是否为 UUID
 * 副作用 (Side-effects): 无
 */
function isUuidString(id: string): boolean {
  // RFC4122：8-4-4-4-12，version 1-5
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

/**
 * **功能 (What):** 修复文件名编码问题 (兜底函数)
 * **输入 (Input / @param):** 
 * @param filename - 可能存在编码问题的文件名
 * **输出 (Output / @returns):** 正确编码的文件名
 * **副作用 (Side-effects):** 无副作用，纯编码转换函数
 */
function fixFilenameEncoding(filename: string): string {
  if (!filename) return filename;

  try {
    const buf = Buffer.from(filename, 'binary');
    const decoded = iconv.decode(buf, 'utf8');
    const readable = /[\u4E00-\u9FFF]/.test(decoded) || /^[\x20-\x7E]+$/.test(decoded);
    if (readable && !decoded.includes('\ufffd')) {
      if (decoded !== filename) {
        logger.info(`[编码修复] 文件名编码修复: "${filename}" -> "${decoded}"`);
      }
      return decoded;
    }
    return filename;
  } catch {
    return filename;
  }
}

/**
 * 原始块的类型定义
 */
export interface RawBlock {
  id?: string;
  text: string;
  type: string;
  heading_level?: number;
  metadata?: {
    page?: number;
    paraIdx?: number;
    [key: string]: unknown;
  };
  source_info?: {
    page_number?: number;
    location?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * 兼容旧命名：ProcessedBlock 实际等价于 ParsedContentBlock（后处理产物）
 */
export type ProcessedBlock = ParsedContentBlock;

/**
 * 后处理结果的类型定义
 */
export interface PostProcessResult {
  sourceDoc: DocumentSoT;
  processedBlocks: ParsedContentBlock[];
  finalDocId: string;
}

/**
 * 功能 (What): 文本块切分/合并策略配置
 * 输入 (Input): 无
 * 输出 (Output): 配置对象
 * 副作用 (Side-effects): 无
 */
interface ChunkPolicy {
  /**
   * 最大“字/词单位数”（超过则切分）
   * - 中文按汉字计 1
   * - 英文按单词计 1
   */
  maxUnits: number;
  /**
   * 最小“字/词单位数”（不足则尝试与相邻段合并）
   * - 目的：避免过碎的块，提升阅读与检索稳定性
   */
  minUnits: number;
}

/**
 * 功能 (What): 应用“先切长后并短”的规范化策略
 * 输入 (Input / @param): 原始块列表与策略配置
 * 输出 (Output / @returns): 规范化后的块列表
 * 副作用 (Side-effects): 无
 */
function normalizeBlocksByChunkPolicy(rawBlocks: RawBlock[], policy: ChunkPolicy): RawBlock[] {
  const sentenceSplit = (text: string): string[] => {
    // 优先按句号/问号/感叹号（中英文）切分，再退化到逗号/顿号，最后硬切
    const primary = text
      .replace(/([。！？!?])+/g, '$1\n')
      .replace(/([\.\?\!])+/g, '$1\n');
    const lines = primary.split(/\n+/).flatMap(line => {
      const l = line.trim();
      if (!l) return [];
      // 次级拆分：逗号/分号/顿号适度切
      return l
        .replace(/([；;，,、])+/g, '$1\n')
        .split(/\n+/)
        .map(s => s.trim())
        .filter(Boolean);
    });
    return lines;
  };

  const splitLongBlock = (block: RawBlock): RawBlock[] => {
    const text = (block.text || '').trim();
    if (countTextUnitsZhEn(text) <= policy.maxUnits) return [block];

    const sentences = sentenceSplit(text);
    if (sentences.length === 0) return [block];

    const chunks: string[] = [];
    let buf = '';
    for (const s of sentences) {
      if (countTextUnitsZhEn(buf + (buf ? ' ' : '') + s) <= policy.maxUnits) {
        buf = buf ? `${buf} ${s}` : s;
      } else {
        if (buf) chunks.push(buf);
        if (countTextUnitsZhEn(s) <= policy.maxUnits) {
          buf = s;
        } else {
          /**
           * 单句仍超过上限：按“字/词单位”硬截断。
           *
           * 注意：
           * - 不能按字符串 length/slice（UTF-16）切，否则会与工具层/拼装层口径不一致；
           * - 这里用统一的 sliceTextByUnitsZhEn() 来保证“最多 500 字/词”。
           */
          let remaining = s;
          while (remaining.length > 0) {
            const part = sliceTextByUnitsZhEn(remaining, policy.maxUnits).trim();
            if (part.length === 0) break;
            chunks.push(part);
            remaining = remaining.slice(part.length).trim();
          }
          buf = '';
        }
      }
    }
    if (buf) chunks.push(buf);

    const baseId = typeof block.id === 'string' && block.id.trim().length > 0 ? block.id.trim() : undefined;
    return chunks.map((t, idx) => {
      /**
       * 根因修复（P1-3）：
       * - 若长块被切分成多个片段，必须为每个片段生成“稳定且唯一”的 block_id；
       * - 同时必须满足 Qdrant 的 point id 约束：只允许无符号整数或 UUID
       *   （不能使用 `${baseId}#${idx}` 这类字符串拼接）。
       */
      const splitId = baseId ? generateSubBlockId(baseId, idx) : undefined;
      return {
        ...block,
        id: splitId,
        // 继承类型与来源，不跨页合并；保持 heading 不被切到其他类型
        text: t,
        // 提示来源：记录来自拆分
        metadata: {
          ...(block.metadata || {}),
          split_from_block_id: baseId,
          split_index: idx
        }
      };
    });
  };

  // 1) 先切长
  const afterSplit: RawBlock[] = rawBlocks.flatMap(rb => splitLongBlock(rb));

  // 2) 再并短：只在同页、同类型（paragraph）且非 heading 时，向右合并直至接近 max 或遇到边界
  const merged: RawBlock[] = [];
  let i = 0;
  
  // 开始合并短块
  let mergeAttempts = 0;
  let successfulMerges = 0;
  
  while (i < afterSplit.length) {
    const cur = afterSplit[i];
    const curType = (cur.type || 'paragraph').toLowerCase();
    const curPage = cur.metadata?.page ?? cur.source_info?.page_number ?? null;
    const isHeading = curType.startsWith('heading');

    // 详细日志在需要时启用

    // 仅 paragraph 尝试合并
    if (
      cur.text &&
      countTextUnitsZhEn(cur.text) < policy.minUnits &&
      !isHeading &&
      curType === 'paragraph'
    ) {
      mergeAttempts++;
      let combined = cur.text.trim();
      let j = i + 1;
      let mergedCount = 0;
      
      while (j < afterSplit.length) {
        const nxt = afterSplit[j];
        const nxtType = (nxt.type || 'paragraph').toLowerCase();
        const nxtPage = nxt.metadata?.page ?? nxt.source_info?.page_number ?? null;
        const nxtIsHeading = nxtType.startsWith('heading');
        
        // 边界条件检查
        if (nxtIsHeading || nxtType !== 'paragraph' || nxtPage !== curPage) {
          break;
        }
        if (countTextUnitsZhEn(combined + '\n' + nxt.text) > policy.maxUnits) {
          break;
        }
        
        combined = `${combined}\n${nxt.text.trim()}`.trim();
        mergedCount++;
        j++;
        
        if (countTextUnitsZhEn(combined) >= policy.minUnits) {
          break;
        }
      }

      if (mergedCount > 0) {
        successfulMerges++;
      }

      // 生成合并块
      const mergedBlock: RawBlock = {
        ...cur,
        text: combined,
        metadata: {
          ...(cur.metadata || {}),
          merged_from: afterSplit.slice(i, Math.max(j, i + 1)).map(b => b.id)
        }
      };
      merged.push(mergedBlock);
      i = Math.max(j, i + 1);
      continue;
    }

    merged.push(cur);
    i++;
  }

  logger.info(`[normalizeBlocksByChunkPolicy] 合并完成: ${afterSplit.length}块 -> ${merged.length}块 (${successfulMerges}个成功合并)`);
  return merged;
}

/**
 * 对解析器返回的原始块列表进行统一的最终处理
 * 
 * 主要职责:
 * 1. 对所有块进行分词，并为整篇文档构建一个统一的关键词词汇表
 * 2. 为每个块生成唯一的、稳定的block_id
 * 3. 提取TOC和父级标题信息
 * 4. 为Source of Truth文件构建内容块
 * 5. 构建并返回最终的SourceOfTruth文档对象和用于Qdrant的块列表
 */
export async function postProcessBlocks({
  rawBlocks,
  sourceFilePath,
  docId,
  originalFilename,
  updater
}: {
  rawBlocks: RawBlock[];
  sourceFilePath: string;
  docId: string;
  originalFilename: string;
  updater?: unknown;
}): Promise<PostProcessResult> {
  if (!docId) {
    throw new Error("postProcessBlocks 必须接收一个有效的 docId。");
  }

  logger.info(`开始后处理 ${rawBlocks.length} 个块...`);
  
  // 输入块统计信息
  const inputStats = rawBlocks.reduce((acc, block) => {
    acc[block.type] = (acc[block.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  logger.info(`[postProcessBlocks] 输入块统计: ${Object.entries(inputStats).map(([type, count]) => `${type}=${count}`).join(', ')}`);

  // 🎯 应用标准化块策略（先切长后并短）
  // ✅ 统一口径：中文按汉字/英文按单词计数；最大 500 字/词（与 deep_search 拼装预览一致）
  const chunkPolicy: ChunkPolicy = { maxUnits: 500, minUnits: 120 };
  const normalizedBlocks = normalizeBlocksByChunkPolicy(rawBlocks, chunkPolicy);

  // 步骤1: 推断文档标题
  // 使用第一个H1类型块的文本作为文档标题，如果没有则使用文件名
  let baseFilename = path.basename(originalFilename, path.extname(originalFilename));
  // 修复文件名编码问题
  let docTitle = fixFilenameEncoding(baseFilename);
  
  const h1Blocks = normalizedBlocks.filter(block => 
    block.type === 'heading' && block.heading_level === 1
  );
  
  if (h1Blocks.length > 0) {
    const candidateTitle = h1Blocks[0].text.trim();
    // 只有当标题非空且不是默认/自动生成标题时才使用
    if (candidateTitle && 
        !candidateTitle.includes('Untitled') &&
        !candidateTitle.includes('Document') &&
        candidateTitle.length < 100) {
      docTitle = candidateTitle;
    }
  }

  logger.info(`推断的文档标题: "${docTitle}"`);

  // 步骤2: 准备Source of Truth文档对象和处理后的块
  const sourceDoc: DocumentSoT = {
    doc_id: docId,
    doc_title: docTitle,
    metadata: {
      source_file: originalFilename,
      source_file_path: sourceFilePath,
      created_at: Date.now(),
      parser_version: 'postprocessor'
    },
    content_blocks: {},
    structure: {
      root: [],
      toc: []
    }
  };

  const processedBlocks: ParsedContentBlock[] = [];

  // 步骤3: 处理每个块，确保生成稳定且 Qdrant 合法的ID
  for (let i = 0; i < normalizedBlocks.length; i++) {
    const block = normalizedBlocks[i];
    
    if (!block.text || block.text.trim().length === 0) {
      logger.debug(`跳过空块 #${i}`);
      continue;
    }

    /**
     * 为块生成稳定ID（后处理阶段必须确保唯一、稳定且合法）：
     * - Qdrant point id 只接受 UUID 或无符号整数
     * - parser 可能提供 id，但不保证其格式满足 Qdrant（例如 16 位 hex / 其他字符串）
     * - 因此：只有当输入 id 为合法 UUID 时才沿用，否则统一用中心化的 idUtils 生成确定性 UUID
     */
    const candidateId = typeof block.id === 'string' ? block.id.trim() : '';
    const blockId =
      candidateId && isUuidString(candidateId)
        ? candidateId
        : generateDeterministicBlockId(docId, i, block.text);

    // 规范化 block_type（与 BlockType 枚举对齐）
    const normalizeBlockType = (rawType: string): { block_type: BlockType; level: number | null } => {
      const t = (rawType || '').trim().toLowerCase();
      if (t === 'paragraph') return { block_type: BlockType.PARAGRAPH, level: null };
      if (t === 'table_row') return { block_type: BlockType.TABLE_ROW, level: null };
      if (t === 'list_item') return { block_type: BlockType.LIST_ITEM, level: null };
      if (t === 'image') return { block_type: BlockType.IMAGE, level: null };
      if (t === 'code') return { block_type: BlockType.CODE, level: null };
      if (t === 'heading') return { block_type: BlockType.HEADING, level: block.heading_level ?? null };

      const headingMatch = /^heading(\d+)$/.exec(t);
      if (headingMatch) {
        const lvl = Number.parseInt(headingMatch[1], 10);
        return { block_type: BlockType.HEADING, level: Number.isFinite(lvl) ? lvl : (block.heading_level ?? null) };
      }

      // 这里不做“兜底吞掉”，避免未知类型悄悄污染 SoT/检索质量
      throw new Error(`postProcessBlocks 发现不支持的 block.type: "${rawType}" (docId=${docId})`);
    };

    const normalized = normalizeBlockType(block.type || 'paragraph');

    // 步骤4: 🔥 重构：创建符合新版简洁规范的块对象
    // 🔥 为每个块文本末尾添加换行符，帮助AI更好地理解块边界
    const textWithNewline = block.text.endsWith('\n') ? block.text : block.text + '\n';
    
    const parentBlockId =
      typeof block.metadata?.split_from_block_id === 'string' && block.metadata.split_from_block_id.trim().length > 0
        ? block.metadata.split_from_block_id.trim()
        : undefined;
    const partIndex =
      typeof block.metadata?.split_index === 'number' && Number.isFinite(block.metadata.split_index) && block.metadata.split_index >= 0
        ? block.metadata.split_index
        : undefined;

    const finalBlock: ParsedContentBlock = {
      id: blockId,
      block_type: normalized.block_type,
      text: textWithNewline,
      level: normalized.level,
      source_info: {
        // 🔥 规范化：字段缺失时保持为 undefined（与 SourceInfoSchema 对齐）
        page_num:
          typeof block.metadata?.page === 'number'
            ? block.metadata.page
            : (typeof block.source_info?.page_number === 'number' ? block.source_info.page_number : undefined),
        para_idx: typeof block.metadata?.paraIdx === 'number' ? block.metadata.paraIdx : undefined,
        source_location: null // 占位符
      },
      ...(parentBlockId ? { parent_block_id: parentBlockId } : {}),
      ...(partIndex === undefined ? {} : { part_index: partIndex })
    };
    
    // 步骤5: 将完整的块对象存入SoT和待处理列表
    // SoT 中存储的对象不应包含 id 字段（id 作为 key）
    const { id, ...blockForSotBase } = finalBlock;

    /**
     * 关键：写入 SoT.content_blocks 的对象必须满足 BlockSchema 的 discriminated union 要求，
     * 不能让 block_type 停留在“联合类型”上，否则 TS 无法确认其属于哪个分支。
     */
    const sotBlock: Block = (() => {
      switch (finalBlock.block_type) {
        case BlockType.PARAGRAPH:
          return { ...blockForSotBase, block_type: BlockType.PARAGRAPH };
        case BlockType.HEADING:
          return { ...blockForSotBase, block_type: BlockType.HEADING };
        case BlockType.TABLE_ROW:
          return { ...blockForSotBase, block_type: BlockType.TABLE_ROW };
        case BlockType.LIST_ITEM:
          // ListItemBlockSchema 的 level 不允许为 null（仅可选 number）
          {
            const { level, ...rest } = blockForSotBase;
            if (level === null) {
              return { ...rest, block_type: BlockType.LIST_ITEM };
            }
            return { ...rest, level, block_type: BlockType.LIST_ITEM };
          }
        case BlockType.IMAGE:
          return { ...blockForSotBase, block_type: BlockType.IMAGE };
        case BlockType.CODE:
          return { ...blockForSotBase, block_type: BlockType.CODE };
      }
    })();

    sourceDoc.content_blocks[blockId] = sotBlock;
    
    sourceDoc.structure.root.push(blockId);
    processedBlocks.push(finalBlock); // 包含id的完整对象，用于后续步骤
  }

  // 步骤6: 构建目录结构 (现在只用于TOC)
  const { toc } = buildHierarchicalStructure(processedBlocks);
  sourceDoc.structure.toc = toc;

  if (processedBlocks.length === 0) {
    logger.warn(`文档 ${docId} 后处理后无内容块`);
  } else {
    logger.info(`成功处理 ${processedBlocks.length} 个块`);
  }

  return {
    sourceDoc,
    processedBlocks,
    finalDocId: docId
  };
}

/**
 * 从处理后的块列表中构建层级结构和目录
 * @param blocks - 处理后的块列表
 * @returns 包含root和toc的对象
 */
type TocEntry = { id: string; text: string; level: number; children: TocEntry[] };

function buildHierarchicalStructure(blocks: ParsedContentBlock[]): { toc: TocEntry[] } {
  const toc: TocEntry[] = [];
  // parentStack的第一个元素是虚拟的根节点
  const parentStack: Array<{ children: TocEntry[]; level: number }> = [{ children: toc, level: 0 }];

  for (const block of blocks) {
    if (block.block_type === BlockType.HEADING && typeof block.level === 'number') {
      const level = block.level;
      const tocEntry: TocEntry = {
        id: block.id,
        text: block.text,
        level: level,
        children: []
      };

      // 寻找正确的父节点
      while (parentStack.length > 1 && parentStack[parentStack.length - 1].level >= level) {
        parentStack.pop();
      }

      if (parentStack.length > 0) {
        parentStack[parentStack.length - 1].children.push(tocEntry);
      }
      parentStack.push({ children: tocEntry.children, level: tocEntry.level });
    }
  }

  return { toc };
} 