// src/renderer/utils/aiContextUtils.js

// 导入 NodeFinder 用于查找特定类型的节点
// 注意：这里使用相对于 apps/renderer 根目录的实际路径，避免打包/测试环境下解析失败
import { NodeFinder } from '../../domains/editor/extensions/position/NodeFinder';
// 🆕 导入 Markdown 序列化器
import { createMarkdownSerializer } from './markdownSerializer';
// 🆕 导入 DocumentView 序列化工具（用于构建 [#ref] 文本 + DocumentView）
import {
  flattenBlocksFromEditor,
  buildBodyFromBlocks as buildBodyFromBlocksForDocumentView,
  buildDocumentView
} from './documentViewSerializer';

// 🔧 集中配置已移除 - 每个功能现在使用独立的配置文件：
// - 侧边栏聊天: apps/renderer/domains/conversation/services/orchestration/context/contextConfig.ts
// - 批注功能: apps/renderer/features/Annotation/config/contextConfig.ts  
// - 编辑器写作: apps/renderer/features/AiWriting/config/contextConfig.ts
// - 自动补全: apps/renderer/features/AutoComplete/config/contextConfig.ts

// 🆕 创建一个 Markdown 序列化器实例
// 我们将使用它来将ProseMirror节点转换为Markdown字符串
const markdownSerializer = createMarkdownSerializer({
  lineBreakStyle: 'standard' // 'standard'会生成更可读的Markdown，带有适当的换行
});

/**
 * 核心函数：统一获取文档上下文（前文、当前块、后文）
 *
 * @param {import('@tiptap/core').Editor} editor - Tiptap 编辑器实例
 * @param {object} options - 配置选项
 * @param {string|null} [options.blockId=null] - 特定块的ID（如果基于块ID获取上下文）
 * @param {number} [options.blocksBefore=0] - 当前块之前要包含的块数量
 * @param {number} [options.blocksAfter=0] - 当前块之后要包含的块数量
 * @param {boolean} [options.includeCurrentBlock=true] - 是否在上下文中包含当前块
 * @param {boolean} [options.separateCurrentBlock=false] - 是否将当前块内容单独返回
 * @param {number|null} [options.charsLimitBefore=null] - 前文的最大字符数限制
 * @param {number|null} [options.charsLimitAfter=null] - 后文的最大字符数限制
 * @param {number|null} [options.charsLimitCurrent=null] - 当前块内容的最大字符数限制 (仅当 separateCurrentBlock=true 时有效)
 * @returns {object} 根据 separateCurrentBlock 配置返回不同格式：
 *          - 如果为 false：{ contextBefore: string | null, contextAfter: string | null }
 *          - 如果为 true：{ contextBefore: string | null, currentBlockContent: string | null, contextAfter: string | null }
 */
function getBlocksContext(editor, options = {}) {
  if (!editor || !editor.state) {
    console.warn('[aiContextUtils] 编辑器实例或状态无效');
    return options.separateCurrentBlock 
      ? { contextBefore: null, currentBlockContent: null, contextAfter: null }
      : { contextBefore: null, contextAfter: null };
  }

  // 解构选项，提供默认值
  const {
    blockId = null,
    position = null, // 🆕 新增可选参数，用于指定上下文锚点
    blocksBefore = 0,
    blocksAfter = 0,
    includeCurrentBlock = true,
    separateCurrentBlock = false,
    charsLimitBefore = null,
    charsLimitAfter = null,
    charsLimitCurrent = null
  } = options;

  console.log('[aiContextUtils getBlocksContext] 配置参数:', {
    blockId,
    blocksBefore,
    blocksAfter,
    separateCurrentBlock,
    includeCurrentBlock
  });

  const { state } = editor;
  const { doc, selection } = state;
  const finder = new NodeFinder(editor);
  
  // 获取所有 rootBlock 节点
  const allRootBlocks = finder.findAllNodesOfType('rootBlock');
  console.log('[aiContextUtils getBlocksContext] 找到 rootBlock 数量:', allRootBlocks.length);
  
  if (allRootBlocks.length === 0) {
    console.warn('[aiContextUtils getBlocksContext] 未找到任何 rootBlock');
    return separateCurrentBlock 
      ? { contextBefore: null, currentBlockContent: null, contextAfter: null }
      : { contextBefore: null, contextAfter: null };
  }

  // 确定目标块索引
  let targetBlockIndex = -1;
  let targetBlockNode = null;

  if (blockId) {
    console.log('[aiContextUtils getBlocksContext] 基于 blockId 查找目标块:', blockId);
    // 基于块ID查找
    for (let i = 0; i < allRootBlocks.length; i++) {
      const blockInfo = allRootBlocks[i];
      console.log(`[aiContextUtils] 检查块 ${i}: id="${blockInfo.node.attrs.id}", 匹配=${blockInfo.node.attrs.id === blockId}`);
      if (blockInfo.node.attrs.id === blockId) {
        targetBlockIndex = i;
        targetBlockNode = blockInfo.node;
        console.log('[aiContextUtils getBlocksContext] 找到目标块:', { index: i, id: blockId });
        break;
      }
    }
    
    if (targetBlockIndex === -1) {
      console.warn(`[aiContextUtils] 找不到ID为${blockId}的rootBlock`);
      return separateCurrentBlock 
        ? { contextBefore: null, currentBlockContent: null, contextAfter: null }
        : { contextBefore: null, contextAfter: null };
    }
  } else {
    // 🆕 基于光标位置或传入的position查找
    const referencePos = position !== null ? position : selection.from;
    
    for (let i = 0; i < allRootBlocks.length; i++) {
      const { node, pos } = allRootBlocks[i];
      const blockEndPos = pos + node.nodeSize;
      
      // 🆕 判断参考点是否在此块内
      if (referencePos >= pos && referencePos < blockEndPos) {
        targetBlockIndex = i;
        targetBlockNode = node;
        break;
      }
      
      // 🆕 仅当没有指定 position 时，才处理光标的特殊情况
      if (position === null && selection.empty && (referencePos === pos || 
          (referencePos === blockEndPos && i < allRootBlocks.length - 1))) {
        targetBlockIndex = i;
        targetBlockNode = node;
        break;
      }
    }
    
    // 文档末尾特殊处理
    if (targetBlockIndex === -1 && (position !== null ? position : selection.from) === doc.content.size && allRootBlocks.length > 0) {
      targetBlockIndex = allRootBlocks.length - 1;
      targetBlockNode = allRootBlocks[targetBlockIndex].node;
    }
    
    if (targetBlockIndex === -1) {
      console.warn('[aiContextUtils] 无法确定当前参考位置所在的块', position !== null ? position : selection.from);
      return separateCurrentBlock 
        ? { contextBefore: null, currentBlockContent: null, contextAfter: null }
        : { contextBefore: null, contextAfter: null };
    }
  }

  // 获取当前块原始内容 (未截断)
  let rawCurrentBlockContent = targetBlockNode ? markdownSerializer.serialize(targetBlockNode) : '';
  console.log('[aiContextUtils getBlocksContext] 目标块内容:', {
    index: targetBlockIndex,
    textLength: rawCurrentBlockContent.length,
    preview: rawCurrentBlockContent.substring(0, 50) + (rawCurrentBlockContent.length > 50 ? '...' : '')
  });
  
  // 收集上文块内容
  const contextBeforeBlocksContent = [];
  if (blocksBefore > 0 || (includeCurrentBlock && !separateCurrentBlock)) {
    const numBlocksToTake = includeCurrentBlock && !separateCurrentBlock ? blocksBefore : Math.max(0, blocksBefore);
    const startIndex = Math.max(0, targetBlockIndex - numBlocksToTake);
    const endIndex = includeCurrentBlock && !separateCurrentBlock ? targetBlockIndex : targetBlockIndex - 1;
    
    for (let i = startIndex; i <= endIndex; i++) {
      if (i >= 0 && i < allRootBlocks.length) {
        contextBeforeBlocksContent.push(markdownSerializer.serialize(allRootBlocks[i].node));
      }
    }
  }
  
  // 收集下文块内容
  const contextAfterBlocksContent = [];
  if (blocksAfter > 0) {
    const startIndexAfter = targetBlockIndex + 1;
    const endIndexAfter = Math.min(allRootBlocks.length, startIndexAfter + blocksAfter);
    
    for (let i = startIndexAfter; i < endIndexAfter; i++) {
      contextAfterBlocksContent.push(markdownSerializer.serialize(allRootBlocks[i].node));
    }
  }
  
  // --- 应用字符限制 --- 
  
  // 处理上文
  let processedContextBefore = contextBeforeBlocksContent.join('').trim();
  if (charsLimitBefore !== null && processedContextBefore.length > charsLimitBefore) {
    // 保留末尾的 charsLimitBefore 个字符
    processedContextBefore = processedContextBefore.slice(-charsLimitBefore);
  }
  const contextBefore = processedContextBefore || null;
  
  // 处理当前块内容 (仅当需要单独返回时)
  let processedCurrentBlockContent = rawCurrentBlockContent;
  if (separateCurrentBlock && charsLimitCurrent !== null && processedCurrentBlockContent.length > charsLimitCurrent) {
     // 保留开头的 charsLimitCurrent 个字符
     processedCurrentBlockContent = processedCurrentBlockContent.slice(0, charsLimitCurrent);
  }
  const currentBlockContent = separateCurrentBlock ? (processedCurrentBlockContent.trim() || null) : null;
  
  // 处理下文
  let processedContextAfter = contextAfterBlocksContent.join('').trim();
  if (charsLimitAfter !== null && processedContextAfter.length > charsLimitAfter) {
     // 保留开头的 charsLimitAfter 个字符
     processedContextAfter = processedContextAfter.slice(0, charsLimitAfter);
  }
  const contextAfter = processedContextAfter || null;
  
  // --- 返回结果 --- 
  return separateCurrentBlock 
    ? { contextBefore, currentBlockContent, contextAfter }
    : { contextBefore, contextAfter };
}

/**
 * 获取当前光标周围的文本上下文
 * 
 * @param {import('@tiptap/core').Editor} editor - Tiptap 编辑器实例
 * @param {object} options - 配置选项
 * @param {number} [options.charsLimit=1200] - 上下文各自的最大字符数限制
 * @returns {{ contextBefore: string | null, contextAfter: string | null }} 包含前后文的对象
 */
export function getContextAroundSelection(editor, options = {}) {
  if (!editor || !editor.state) {
    console.warn('[aiContextUtils] 编辑器实例或状态无效');
    return { contextBefore: null, contextAfter: null };
  }

  const { state } = editor;
  const { selection, doc, schema } = state;
  const { charsLimit = 1200 } = options;

  const fromPos = selection.from;
  const toPos = selection.to;

  const startPosBefore = Math.max(0, fromPos - charsLimit);
  const sliceBefore = doc.slice(startPosBefore, fromPos);
  const nodeForBefore = schema.topNodeType.create(null, sliceBefore.content);
  const contextBefore = markdownSerializer.serialize(nodeForBefore).trim();

  const endPosAfter = Math.min(doc.content.size, toPos + charsLimit);
  const sliceAfter = doc.slice(toPos, endPosAfter);
  const nodeForAfter = schema.topNodeType.create(null, sliceAfter.content);
  const contextAfter = markdownSerializer.serialize(nodeForAfter).trim();

  return {
    contextBefore: contextBefore || null,
    contextAfter: contextAfter || null,
  };
}

/**
 * 根据块数量检索上下文
 *
 * @param {import('@tiptap/core').Editor} editor - Tiptap 编辑器实例
 * @param {object} options - 配置选项
 * @param {number} [options.blocksBefore=0] - 需要包含的当前块之前的块数量
 * @param {number} [options.blocksAfter=0] - 需要包含的当前块之后的块数量
 * @param {boolean} [options.includeCurrentBlock=true] - 是否在上下文中包含当前块
 * @returns {{ contextBefore: string | null, contextAfter: string | null }}
 */
export function getBlockContextByCounts(editor, options = {}) {
  return getBlocksContext(editor, {
    ...options,
    separateCurrentBlock: false
  });
}

/**
 * 获取块级上下文的便捷函数
 *
 * @param {import('@tiptap/core').Editor} editor - Tiptap 编辑器实例
 * @param {object} options - 必需的上下文配置选项
 * @returns {{ contextBefore: string | null, contextAfter: string | null }}
 */
export function getDefaultBlockContext(editor, options) {
  if (!options) {
    throw new Error('[aiContextUtils] getDefaultBlockContext 需要传入配置选项，请使用各功能模块的配置文件');
  }
  return getBlocksContext(editor, options);
}

/**
 * 为批注 AI 功能获取特定范围的上下文
 *
 * @param {import('@tiptap/core').Editor} editor - Tiptap 编辑器实例
 * @param {string} blockId - 与批注关联的目标 rootBlock 的 ID
 * @param {object} options - 必需的批注上下文配置选项
 * @returns {{ contextBefore: string | null, currentBlockContent: string | null, contextAfter: string | null } | null}
 */
export function getAnnotationContext(editor, blockId, options) {
  if (!blockId) {
    console.warn('[aiContextUtils getAnnotationContext] blockId 无效');
    return null;
  }
  
  if (!options) {
    throw new Error('[aiContextUtils] getAnnotationContext 需要传入配置选项，请使用 Annotation/config/contextConfig.ts');
  }
  
  console.log('[aiContextUtils getAnnotationContext] 开始获取批注上下文:', { blockId, options });
  
  // 添加 blockId 到配置中
  const config = { 
    ...options,
    blockId // 确保 blockId 总是被包含
  };
  
  const result = getBlocksContext(editor, config);
  console.log('[aiContextUtils getAnnotationContext] getBlocksContext 返回:', result);
  
  // 保持之前的逻辑：仅当当前块内容存在时才返回结果
  const willReturn = result.currentBlockContent !== null ? result : null;
  console.log('[aiContextUtils getAnnotationContext] 最终返回:', willReturn);
  
  return willReturn;
}

/**
 * 🆕 新增函数：获取基于视口中心的上下文
 * 计算编辑器可见区域的中心点，并以此为锚点获取上下文。
 *
 * @param {import('@tiptap/core').Editor} editor - Tiptap 编辑器实例
 * @param {object} options - 上下文配置选项
 * @returns {{ contextBefore: string | null, contextAfter: string | null }}
 */
export function getViewportContext(editor, options) {
  if (!editor || !editor.view) {
    console.warn('[aiContextUtils getViewportContext] 编辑器实例或视图无效');
    // 视图无效时，回退到基于光标的方法
    return getDefaultBlockContext(editor, options);
  }
  
  const { view } = editor;
  const editorDom = view.dom;
  const editorRect = editorDom.getBoundingClientRect();
  
  // 🎯 直接查找 .editor-shell 作为滚动容器
  const scrollContainer = editorDom.closest('.editor-shell');
  
  let viewportRect;
  // 根据是否找到容器来获取其边界
  if (scrollContainer) {
    viewportRect = scrollContainer.getBoundingClientRect();
  } else {
    console.warn('[aiContextUtils getViewportContext] 未找到 .editor-shell 滚动容器，将使用 window 作为回退。');
    viewportRect = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  }

  // 计算编辑器DOM与滚动容器视口的交集，即真正可见的区域
  const visibleTop = Math.max(viewportRect.top, editorRect.top);
  const visibleBottom = Math.min(viewportRect.bottom, editorRect.bottom);
  
  // 如果编辑器在垂直方向上完全不可见，则回退
  if (visibleTop >= visibleBottom) {
    console.warn('[aiContextUtils getViewportContext] 编辑器在垂直方向上不可见，回退到基于光标获取上下文。');
    return getDefaultBlockContext(editor, options);
  }
  
  // 计算可见区域的中心点坐标
  const centerX = editorRect.left + editorRect.width / 2;
  const centerY = (visibleTop + visibleBottom) / 2;
  
  // 从坐标获取文档位置
  const posResult = view.posAtCoords({ left: centerX, top: centerY });

  // 如果无法从坐标解析出有效位置，则回退到基于光标的默认行为
  if (!posResult || typeof posResult.pos !== 'number') {
    console.warn('[aiContextUtils getViewportContext] 无法从视口中心确定文档位置，将回退到基于光标的上下文获取。');
    return getDefaultBlockContext(editor, options);
  }
  
  // 使用计算出的位置来获取上下文
  return getBlocksContext(editor, {
    ...options,
    position: posResult.pos // 传入计算出的锚点位置
  });
}

/**
 * 🆕 基于视口中心构建 DocumentView 文本（块级 [#ref] 格式）
 *
 * 与 getViewportContext 不同，这里返回的是统一的 DocumentView 文本：
 * <workspace_document>
 * document_id: ...
 * doc_type: markdown
 * source: editor
 * ...
 * ---
 * [#aZ3kP9] 第10段内容...
 * [#m2L0q3] 第11段内容...
 * </workspace_document>
 *
 * 注意：
 * - 只会选择有限数量的块：以视口中心所在块为锚点，前 blocksBefore + 后 blocksAfter
 * - index 始终保持为「整篇文档的全局序号」，不会重排成 1,2,3...
 *
 * @param {import('@tiptap/core').Editor} editor - Tiptap 编辑器实例
 * @param {object} options - 与 getViewportContext 相同的块/字符配置（至少需要 blocksBefore/blocksAfter）
 * @param {object} extra - 额外参数：{ documentId?: string, maxChars?: number }
 * @returns {{ documentViewText: string, totalTextLength: number, truncatedByChars: boolean, nextOffset: number | null } | null}
 */
export async function getViewportDocumentView(editor, options = {}, extra = {}) {
  if (!editor || !editor.view || !editor.state) {
    console.warn('[aiContextUtils getViewportDocumentView] 编辑器实例或视图无效');
    return null;
  }

  const { view } = editor;
  const editorDom = view.dom;
  const editorRect = editorDom.getBoundingClientRect();

  // 复用与 getViewportContext 相同的可见区域计算逻辑
  const scrollContainer = editorDom.closest('.editor-shell');

  let viewportRect;
  if (scrollContainer) {
    viewportRect = scrollContainer.getBoundingClientRect();
  } else {
    console.warn(
      '[aiContextUtils getViewportDocumentView] 未找到 .editor-shell 滚动容器，将使用 window 作为回退。'
    );
    viewportRect = { top: 0, bottom: window.innerHeight, left: 0, right: window.innerWidth };
  }

  const visibleTop = Math.max(viewportRect.top, editorRect.top);
  const visibleBottom = Math.min(viewportRect.bottom, editorRect.bottom);

  if (visibleTop >= visibleBottom) {
    console.warn(
      '[aiContextUtils getViewportDocumentView] 编辑器在垂直方向上不可见，无法构建 DocumentView。'
    );
    return null;
  }

  const centerX = editorRect.left + editorRect.width / 2;
  const centerY = (visibleTop + visibleBottom) / 2;

  const posResult = view.posAtCoords({ left: centerX, top: centerY });

  if (!posResult || typeof posResult.pos !== 'number') {
    console.warn(
      '[aiContextUtils getViewportDocumentView] 无法从视口中心确定文档位置，放弃构建 DocumentView。'
    );
    return null;
  }

  const referencePos = posResult.pos;

  const finder = new NodeFinder(editor);
  const allRootBlocks = finder.findAllNodesOfType('rootBlock');

  if (allRootBlocks.length === 0) {
    console.warn('[aiContextUtils getViewportDocumentView] 未找到任何 rootBlock');
    return null;
  }

  // --- 确定视口中心所在的目标块索引（与 getBlocksContext 的逻辑保持一致） ---
  let targetBlockIndex = -1;
  for (let i = 0; i < allRootBlocks.length; i++) {
    const { node, pos } = allRootBlocks[i];
    const blockEndPos = pos + node.nodeSize;

    if (referencePos >= pos && referencePos < blockEndPos) {
      targetBlockIndex = i;
      break;
    }
  }

  // 文档末尾特殊处理
  if (targetBlockIndex === -1 && referencePos === editor.state.doc.content.size && allRootBlocks.length > 0) {
    targetBlockIndex = allRootBlocks.length - 1;
  }

  if (targetBlockIndex === -1) {
    console.warn(
      '[aiContextUtils getViewportDocumentView] 无法确定视口中心所在的块',
      referencePos
    );
    return null;
  }

  const {
    blocksBefore = 0,
    blocksAfter = 0
  } = options;

  // 计算需要包含的块范围（基于全局块序号的 0-based 索引）
  const startIndex = Math.max(0, targetBlockIndex - blocksBefore);
  const endIndex = Math.min(allRootBlocks.length - 1, targetBlockIndex + blocksAfter);

  // 使用共享的 flattenBlocksFromEditor 获取整篇文档的展平块列表（带全局 index）
  const flattened = flattenBlocksFromEditor(editor);
  if (!flattened || flattened.length === 0) {
    console.warn('[aiContextUtils getViewportDocumentView] flattenBlocksFromEditor 返回空');
    return null;
  }

  // 选出处于 [startIndex, endIndex] 范围内的块，同时保持原始 index 不变
  const selectedBlocks = flattened.filter((block) => {
    const zeroBasedIndex = block.index - 1;
    return zeroBasedIndex >= startIndex && zeroBasedIndex <= endIndex;
  });

  if (selectedBlocks.length === 0) {
    console.warn(
      '[aiContextUtils getViewportDocumentView] 选出的块列表为空，无法构建 DocumentView'
    );
    return null;
  }

  // 构建 [#ref] 文本正文（vNext 协议：ref 与 blockId 绑定）
  let body = await buildBodyFromBlocksForDocumentView(
    selectedBlocks.map((block) => ({
      index: block.index,
      blockId: block.blockId,
      markdown: block.text ?? block.markdown ?? ''
    }))
  );

  const { documentId = 'unknown', maxChars } = extra;

  let truncatedByChars = false;
  let nextOffset = null;

  // 简单的字符级裁剪：如果提供 maxChars，则限制正文长度
  if (typeof maxChars === 'number' && maxChars > 0 && body.length > maxChars) {
    body = body.slice(0, maxChars);
    truncatedByChars = true;
    nextOffset = body.length;
  }

  const totalTextLength = body.length;
  const blocksShown = selectedBlocks.length;
  const blocksTotal = flattened.length;
  const isPartialByBlocks = blocksShown < blocksTotal;

  const meta = {
    documentId,
    docType: 'markdown',
    source: 'editor',
    offsetChars: 0,
    truncatedByChars,
    totalTextLength,
    nextOffset,
    ...(isPartialByBlocks ? { blocksShown, blocksTotal } : {})
  };

  const documentViewText = buildDocumentView(meta, body);

  return {
    documentViewText,
    totalTextLength,
    truncatedByChars,
    nextOffset
  };
}

/**
 * 为自动补全 AI 功能获取特定范围的上下文 (考虑块和字符限制)
 *
 * @param {import('@tiptap/core').Editor} editor - Tiptap 编辑器实例
 * @param {object} options - 必需的自动补全上下文配置选项
 * @returns {{ contextBefore: string | null, contextAfter: string | null }}
 */
export function getAutocompleteContext(editor, options) {
  if (!editor || !editor.state) {
    console.warn('[aiContextUtils getAutocompleteContext] 编辑器实例或状态无效');
    return { contextBefore: null, contextAfter: null };
  }

  if (!options) {
    throw new Error('[aiContextUtils] getAutocompleteContext 需要传入配置选项，请使用 AutoComplete/config/contextConfig.ts');
  }

  const config = options;
  const { blocksBefore, charsLimitBefore, blocksAfter, charsLimitAfter } = config;

  const { state } = editor;
  const { doc, selection } = state;
  
  if (!selection.empty) {
      return { contextBefore: null, contextAfter: null };
  }
  const cursorPos = selection.from;

  const finder = new NodeFinder(editor);
  const allRootBlocks = finder.findAllNodesOfType('rootBlock');
  if (allRootBlocks.length === 0) {
    return { contextBefore: null, contextAfter: null };
  }

  // --- 确定光标所在 rootBlock ---
  // 关键修复（中文）：
  // 旧实现将 markdownSerializer 的输出字符串与 doc.textBetween 的纯文本长度混用，
  // 会导致“字符串切分点 ≠ 光标位置”，从而出现前后文不准确（看似光标偏移）的现象。
  // 新实现统一使用 ProseMirror slice + markdownSerializer 序列化，保证切分点与光标一致。
  let targetBlockIndex = -1;
  for (let i = 0; i < allRootBlocks.length; i++) {
    const { node, pos } = allRootBlocks[i];
    const end = pos + node.nodeSize;
    if (cursorPos >= pos && cursorPos <= end) {
      targetBlockIndex = i;
      break;
    }
  }

  if (targetBlockIndex === -1) {
    console.warn('[aiContextUtils getAutocompleteContext] 无法确定光标所在的 rootBlock', cursorPos);
    return { contextBefore: null, contextAfter: null };
  }

  // blocksBefore/blocksAfter 的语义：以“当前 rootBlock”为锚点，向前/向后扩展块范围；
  // 同时 contextBefore 只取到光标位置，contextAfter 从光标位置开始。
  const startIndexBefore = Math.max(0, targetBlockIndex - blocksBefore);
  const endIndexAfter = Math.min(allRootBlocks.length - 1, targetBlockIndex + blocksAfter);

  const startPos = allRootBlocks[startIndexBefore].pos;
  const endPos = allRootBlocks[endIndexAfter].pos + allRootBlocks[endIndexAfter].node.nodeSize;

  // --- 构建 contextBefore：从 startPos 到 cursorPos ---
  let contextBefore = null;
  try {
    if (cursorPos > startPos) {
      const sliceBefore = doc.slice(startPos, cursorPos);
      const nodeForBefore = state.schema.topNodeType.create(null, sliceBefore.content);
      const serializedBefore = markdownSerializer.serialize(nodeForBefore).trim();
      if (serializedBefore) {
        let text = serializedBefore;
        if (charsLimitBefore !== null && text.length > charsLimitBefore) {
          text = text.slice(-charsLimitBefore);
        }
        contextBefore = text.trim() || null;
      }
    }
  } catch (e) {
    console.warn('[aiContextUtils getAutocompleteContext] 生成 contextBefore 失败', e);
  }

  // --- 构建 contextAfter：从 cursorPos 到 endPos ---
  let contextAfter = null;
  try {
    if (endPos > cursorPos) {
      const sliceAfter = doc.slice(cursorPos, endPos);
      const nodeForAfter = state.schema.topNodeType.create(null, sliceAfter.content);
      const serializedAfter = markdownSerializer.serialize(nodeForAfter).trim();
      if (serializedAfter) {
        let text = serializedAfter;
        if (charsLimitAfter !== null && text.length > charsLimitAfter) {
          text = text.slice(0, charsLimitAfter);
        }
        contextAfter = text.trim() || null;
      }
    }
  } catch (e) {
    console.warn('[aiContextUtils getAutocompleteContext] 生成 contextAfter 失败', e);
  }

  return {
    contextBefore,
    contextAfter,
  };
}

// 未来可以添加其他获取上下文的函数，例如：
// - getContextAroundBlock(editor, blockId, options)
// - getSelectedTextContext(editor, options)
