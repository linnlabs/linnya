// src/renderer/shared/extensions/markdown/streaming/queueProcessor.js
// 流式处理器 - 基于 WASM BlockEvent

import { Slice, Fragment } from '@tiptap/pm/model';
import { STREAMING_PLUGIN_KEY } from '../StreamingMarkdown';
import { TextSelection } from 'prosemirror-state';
import { generateBlockId } from '../../../../../../shared/utils/idUtils';
import { NodeFinder } from '../../../position/NodeFinder';
import { PositionUtils } from '../../../position/PositionUtils';
import { buildInlineNodesFromStructuredContent } from '../../../../services/markdownRuntime';
import { resolveCurrentEditorMessage } from '../../../../functions/resolveCurrentEditorMessage';
// PositionUtils 已在 EditorContent.vue 中用于初始化插件状态，这里不再直接需要

// 在文件顶部或合适的位置定义一个常量作为元数据键
const IS_STREAMING_CONTENT_TRANSACTION = 'isStreamingContentTransaction';

/**
 * 流式处理函数 - 基于 WASM BlockEvent
 * @param {object} editor - Tiptap 编辑器实例
 * @param {object} pluginState - 当前 StreamingMarkdown 插件的状态
 * @param {Array<object>} inputData - BlockEvent 数组 (来自WASM StreamingParser)
 * @param {object} options - 选项 { finalize: boolean, errorOccurred?: boolean, closedAbnormally?: boolean }
 */
export function processQueue(editor, pluginState, inputData, options = {}) {
    const { finalize = false, errorOccurred = false, closedAbnormally = false } = options;

    if (!editor || !editor.view || editor.isDestroyed) {
        // console.warn('[处理器 WSM] 编辑器无效');
        return;
    }
    
    // 从插件状态获取所需信息
    const { currentInsertPos, initialBlockContext, hasProcessedFirstEventYet } = pluginState;
    let newCurrentInsertPos = currentInsertPos; // 用于在循环中更新
    let newHasProcessedFirstEventYet = hasProcessedFirstEventYet;

    try {
        const eventsToProcess = Array.isArray(inputData) ? inputData : [];
        for (const blockEvent of eventsToProcess) {
            if (blockEvent && typeof blockEvent.block_type === 'string') {
                // +++ 新增过滤逻辑 +++
                if (blockEvent.block_type === 'BaseBlock') {
                    const isEmptyStructuredContent = !blockEvent.structured_content || blockEvent.structured_content.every(f => f.type === 'text' && (f.text == null || f.text.trim() === ''));
                    const isEmptyRawContent = !blockEvent.raw_content_fallback || blockEvent.raw_content_fallback.trim() === '';
                    if (isEmptyStructuredContent && isEmptyRawContent) {
                        // 如果这是流中的唯一事件或第一个有效事件之前的空事件，我们需要确保 hasProcessedFirstEventYet 的逻辑仍然有机会运行
                        // 对于简单跳过，如果后续没有其他有效事件，hasProcessedFirstEventYet 可能不会变true，currentInsertPos 也不会更新。
                        // 但如果后续有事件，它们会正确处理。如果流只包含空块，则不应插入任何内容，状态应保持或在finalize时重置。
                        // 暂时简单跳过，不改变 newHasProcessedFirstEventYet 或 newCurrentInsertPos，让后续的有效块或finalize处理状态。
                        continue; 
                    }
                }
                // --- 结束新增过滤逻辑 ---

                const isFirstEventInStream = !newHasProcessedFirstEventYet;
                
                // 调用 insertBlockEvent，传递所需状态
                const insertionResult = insertBlockEvent(
                    editor, 
                    blockEvent, 
                    isFirstEventInStream, 
                    initialBlockContext, 
                    newCurrentInsertPos 
                );

                if (insertionResult) {
                    newCurrentInsertPos = insertionResult.newInsertPos;
                    newHasProcessedFirstEventYet = true; // 标记第一个事件已处理
                } else {
                    // 插入失败，保持当前 newCurrentInsertPos，避免后续插入位置错误
                }
            } else {
            }
        }
        
        // 如果处理了任何事件，并且 newCurrentInsertPos 有效，则更新插件状态
        if (newHasProcessedFirstEventYet !== hasProcessedFirstEventYet || (newCurrentInsertPos !== null && newCurrentInsertPos !== currentInsertPos) ) {
            editor.commands.setStreamingState?.({
                currentInsertPos: newCurrentInsertPos,
                hasProcessedFirstEventYet: newHasProcessedFirstEventYet
            });
        }

        if (finalize) {
            // 流结束时重置插件状态
            let finalErrorState = pluginState.streamingError;
            if (!finalErrorState && (errorOccurred || closedAbnormally)) {
                finalErrorState = {
                    message: resolveCurrentEditorMessage('editor.aiWriting.error.streamEndedAbnormally'),
                    code: closedAbnormally ? "closed_abnormally" : "stream_error"
                };
            }
            
            // 在 finalize 时，如果整个流都没有处理过任何有效事件 (hasProcessedFirstEventYet 仍然是 false)
            // 并且 currentInsertPos 仍然是初始触发位置 (来自 pluginState.currentInsertPos，因为 newCurrentInsertPos 未被修改)
            // 这可能意味着流是空的，或者只包含被跳过的空块。在这种情况下，我们不应该错误地保留旧的 currentInsertPos。
            // 最安全的做法是，只要是 finalize，就总是清理 currentInsertPos 和 initialBlockContext。
            // （当前的 finalize 逻辑已经是这样做的，所以这里只是一个注释思考）

            editor.commands.setStreamingState?.({
                isActiveStream: false,
                streamingError: finalErrorState,
                currentInsertPos: null,      // 清理
                initialBlockContext: null, // 清理
                hasProcessedFirstEventYet: false // 重置为下一次流准备
            });
        }
    } catch (error) {
        console.error('[StreamingMarkdown] 队列处理失败:', error);
        editor.commands.setStreamingState?.({
            isActiveStream: false,
            streamingError: {
                message: resolveCurrentEditorMessage('editor.aiWriting.error.queueProcessingFailed'),
                code: "queue_processing_error"
            },
            currentInsertPos: null,
            initialBlockContext: null,
            hasProcessedFirstEventYet: false
        });
    }
}


/**
 * 根据 BlockEvent 在编辑器中插入内容。
 * @param {object} editor - Tiptap 编辑器实例
 * @param {object} blockEvent - 从 WASM StreamingParser 获取的 BlockEvent 对象
 * @param {boolean} isFirstEventInStream - 是否是当前流的第一个事件
 * @param {object | null} initialBlockCtx - 初始触发点上下文 (来自插件状态)
 * @param {number | null} currentTargetInsertPos - 当前建议的插入位置 (来自插件状态)
 * @returns {{ newInsertPos: number } | null} 返回新的插入位置，如果插入失败则返回null
 */
function insertBlockEvent(editor, blockEvent, isFirstEventInStream, initialBlockCtx, currentTargetInsertPos) {
    if (!blockEvent || typeof blockEvent.block_type !== 'string' || !editor.schema) {
        // console.warn('[处理器 WSM] insertBlockEvent 收到无效的 blockEvent 或 schema 无效:', blockEvent);
        return null;
    }

    const { block_type: originalBlockType, raw_content_fallback, language, level: blockLevel, structured_content } = blockEvent;

    // let tr = editor.state.tr; // 不再需要手动创建事务
    let actualInsertPos;
    // let insertedNode = null; // 不再直接跟踪 insertedNode

    // --- 情况 A: 填充现有空 BaseBlock ---
    if (isFirstEventInStream && initialBlockCtx?.isInEmptyBaseBlock && originalBlockType === 'BaseBlock') {
        const contentNodes = buildContentFromBlockEvent(blockEvent, editor.schema);
        if (contentNodes.length > 0) {
            actualInsertPos = initialBlockCtx.emptyBaseBlockNodePos !== null 
                              ? initialBlockCtx.emptyBaseBlockNodePos + 1 
                              : initialBlockCtx.originalTriggerPos; // Fallback

            if (initialBlockCtx.emptyBaseBlockNodePos === null) {
                // console.warn('[处理器 WSM] initialBlockCtx.emptyBaseBlockNodePos 为 null，将尝试使用 Tiptap 命令在原始触发点填充。');
                 return insertNewRootBlock(editor, blockEvent, initialBlockCtx.originalTriggerPos);
            }
                        
            const fromPos = actualInsertPos;
            const emptyBaseBlockNode = editor.state.doc.nodeAt(initialBlockCtx.emptyBaseBlockNodePos);
            let toPos = fromPos;
            if (emptyBaseBlockNode && emptyBaseBlockNode.content.size > 0) { 
                 toPos = initialBlockCtx.emptyBaseBlockNodePos + 1 + emptyBaseBlockNode.content.size;
            }

            const fragmentToInsert = Fragment.fromArray(contentNodes); 

            const success = editor.chain()
                .setMeta(IS_STREAMING_CONTENT_TRANSACTION, true)
                .insertContentAt({ from: fromPos, to: toPos }, fragmentToInsert.toJSON()) 
                .run();

            if (success) {
                return { newInsertPos: initialBlockCtx.initialRootBlockEndPos };
            } else {
                return null;
            }
        } else {
             return initialBlockCtx?.initialRootBlockEndPos !== null ? { newInsertPos: initialBlockCtx.initialRootBlockEndPos } : null;
        }
    } 
    // --- 情况 B: 插入新的 RootBlock ---
    else {
       return insertNewRootBlock(editor, blockEvent, currentTargetInsertPos);
    }
}

/**
 * 辅助函数：创建并插入一个新的 RootBlock
 */
function insertNewRootBlock(editor, blockEvent, targetInsertPos) {
    const {
        block_type: contentType,
        raw_content_fallback,
        language,
        level: blockLevel,
    } = blockEvent;

    const schema = editor.schema;
    const generatedContentNodeId = generateBlockId(); // Generate ID for the content node

    const blockAttrs = { id: generatedContentNodeId }; // Pass this ID to createRootBlock
    if (contentType === 'LatexBlock') {
        blockAttrs.latexSource = raw_content_fallback || '';
        blockAttrs.blockType = 'latex'; 
    } else if (contentType === 'HeadingBlock') {
        blockAttrs.level = blockLevel || 1;
    } else if (contentType === 'CodeBlock') {
        blockAttrs.language = language || '';
    } else if (contentType === 'ListItemBlock') {
        blockAttrs.listType = blockEvent.list_type || 'bullet';
        blockAttrs.level = blockEvent.list_level || 0;
    }

    // 特殊处理：TableBlock 需要根据 attrs 中的 TableModel 构建表格节点树
    let effectiveContentType = contentType;
    let tableChildren = null;
    if (contentType === 'TableBlock') {
        tableChildren = buildTableContentFromBlockEvent(blockEvent, schema);
        if (tableChildren && tableChildren.length > 0 && schema.nodes.table) {
            effectiveContentType = 'table';
        } else {
            // 如果模型不合法或 schema 缺少 table，退化为 BaseBlock
            effectiveContentType = 'BaseBlock';
        }
    }

    let contentChildren = undefined;
    if (tableChildren) {
        contentChildren = tableChildren;
    } else if (['BaseBlock', 'HeadingBlock', 'QuoteBlock', 'ListItemBlock'].includes(effectiveContentType)) {
        const builtChildren = buildContentFromBlockEvent(blockEvent, schema);
        if (builtChildren && builtChildren.length > 0) {
            contentChildren = builtChildren;
        }
    } else if (effectiveContentType === 'CodeBlock' && raw_content_fallback) {
        contentChildren = [schema.text(raw_content_fallback)];
    }

    let commandPosition = 'end';
    let commandReferencePos = null;
    const docSize = editor.state.doc.content.size;

    if (targetInsertPos !== null && targetInsertPos >= 0 && targetInsertPos < docSize) {
        const posUtils = new PositionUtils(editor);
        const $resolvedPos = editor.state.doc.resolve(Math.max(0, targetInsertPos -1)); 
        let refBlockFound = false;
        for (let d = $resolvedPos.depth; d >= 0; d--) {
            const node = $resolvedPos.node(d);
            if (node.type.name === 'rootBlock') {
                commandReferencePos = $resolvedPos.before(d+1); 
                commandPosition = 'after';
                refBlockFound = true;
                break;
            }
        }
        if (!refBlockFound) {
            commandPosition = 'end';
        }
    } else if (docSize === 0) {
        commandPosition = 'start';
    } else {
        commandPosition = 'end';
    }
    
    let success = false;
    try {
        success = editor.commands.createRootBlock({
            position: commandPosition,
            referencePos: commandReferencePos,
            contentType: effectiveContentType,
            blockAttrs: blockAttrs, 
            contentChildren: contentChildren,
        });
    } catch (e) {
        return null;
    }

    if (success) {
        const nodeFinder = new NodeFinder(editor); // editor.nodeFinder might be better if already instantiated
        const insertedContentNodeInfo = nodeFinder.findNodeById(generatedContentNodeId);

        if (insertedContentNodeInfo) {
            let parentRootBlockPos = -1;
            let parentRootBlockSize = 0;
            editor.state.doc.nodesBetween(0, editor.state.doc.content.size, (node, pos) => {
                if (node.type.name === 'rootBlock') {
                    if (pos < insertedContentNodeInfo.pos && pos + node.nodeSize > insertedContentNodeInfo.pos) {
                        parentRootBlockPos = pos;
                        parentRootBlockSize = node.nodeSize;
                        return false; 
                    }
                }
            });

            if (parentRootBlockPos !== -1) {
                const newInsertPosition = parentRootBlockPos + parentRootBlockSize;
                return { newInsertPos: newInsertPosition };
            } else {
                const fallbackInsertPosition = editor.state.doc.content.size; 
                return { newInsertPos: fallbackInsertPosition }; 
            }
        } else {
            const fallbackInsertPosition = editor.state.doc.content.size; 
            return { newInsertPos: fallbackInsertPosition }; 
        }
    } else {
        return null; 
    }
}


/**
 * 从BlockEvent构建内容
 * @param {object} blockEvent - BlockEvent对象
 * @param {object} schema - ProseMirror schema
 * @returns {Array} - 内容节点数组
 */
function buildContentFromBlockEvent(blockEvent, schema) {
    const { structured_content, raw_content_fallback } = blockEvent;
    return (
        buildInlineNodesFromStructuredContent(structured_content, raw_content_fallback, schema) || []
    );
}

/**
 * 从 TableBlockEvent.attrs 中的 TableModel 构建 table 节点的子节点（若干 tableRow）。
 * 返回的数组将作为 table 节点的 children 传给 createRootBlock。
 */
function buildTableContentFromBlockEvent(blockEvent, schema) {
    const tableModel = blockEvent.attrs;
    if (!tableModel || typeof tableModel !== 'object') return null;

    const {
        with_header_row,
        header = [],
        rows = [],
    } = tableModel;

    const rowNodes = [];

    // 帮助函数：从 TableCellModel.content 构建 tableCellContentBlock 的 inline 内容
    const buildCellContentNode = (cellModel) => {
        if (!cellModel || !Array.isArray(cellModel.content)) return null;
        const fakeEvent = {
            structured_content: cellModel.content,
            raw_content_fallback: null,
        };
        const inlineNodes = buildContentFromBlockEvent(fakeEvent, schema);
        const contentBlockType = schema.nodes.tableCellContentBlock;
        if (!contentBlockType) return null;
        return contentBlockType.create({}, inlineNodes && inlineNodes.length > 0 ? inlineNodes : undefined);
    };

    const headerCellType = schema.nodes.tableHeader;
    const cellType = schema.nodes.tableCell;
    const rowType = schema.nodes.tableRow;

    if (!rowType || !cellType || !headerCellType) {
        return null;
    }

    // 表头行
    if (with_header_row && Array.isArray(header) && header.length > 0) {
        const headerCells = header
            .map(cellModel => {
                const contentNode = buildCellContentNode(cellModel);
                if (!contentNode) return null;
                return headerCellType.create({}, [contentNode]);
            })
            .filter(Boolean);
        if (headerCells.length > 0) {
            rowNodes.push(rowType.create({}, headerCells));
        }
    }

    // 数据行
    if (Array.isArray(rows)) {
        rows.forEach(rowModel => {
            if (!rowModel || !Array.isArray(rowModel.cells)) return;
            const cells = rowModel.cells
                .map(cellModel => {
                    const contentNode = buildCellContentNode(cellModel);
                    if (!contentNode) return null;
                    return cellType.create({}, [contentNode]);
                })
                .filter(Boolean);
            if (cells.length > 0) {
                rowNodes.push(rowType.create({}, cells));
            }
        });
    }

    return rowNodes;
}

/**
 * 获取当前的最后插入位置 (主要用于EditorContent.vue中流结束后定位光标)
 * 注意：此函数现在从插件状态读取，如果流未激活或未处理，可能返回null
 * @param {object} editor - Tiptap 编辑器实例
 * @returns {number|null} 最后插入位置
 */
export function getLastInsertPos(editor) {
    if (!editor) return null;
    const pluginState = STREAMING_PLUGIN_KEY.getState(editor.state);
    // 返回 currentInsertPos，即使它可能是上一个块的结束位置。
    // 如果流刚刚结束，这应该是最后一个插入内容之后的位置。
    return pluginState?.currentInsertPos;
} 
