// src/renderer/app/core/extensions/commands/SplitCommands.js
/**
 * SplitCommands.js
 * 
 * 定义块拆分相关命令，使用 ProseMirror 的 tr.split 命令。
 * 此命令旨在根据当前 schema 信息，在指定位置拆分现有的块结构。
 * 适配固定文档结构：doc -> rootBlock -> contentBlock。
 */

import { TextSelection } from 'prosemirror-state';
import { generateBlockId, generateRootBlockId } from '../../../../../shared/utils/idUtils';
import { resolveCurrentEditorMessage } from '../../../functions/resolveCurrentEditorMessage';
import { NODE_GROUPS } from '../schema'; // NODE_GROUPS 仍可用于定义允许拆分的类型列表

/**
 * 块拆分命令 - 固定的 doc -> rootBlock -> contentBlock 结构。
 * 
 * @param {number} [pos=null] - 要拆分的位置。如果为 null，则使用当前选区位置。
 * @returns {import('@tiptap/core').RawCommands['splitBlock']} 返回可执行的命令函数。
 */
export const splitBlockCommand = (pos = null) => {
  return ({ state, dispatch, editor }) => {
    try {
      const { selection, schema, tr } = state;
      
      // 仅处理光标选区 (没有选中文本范围)
      if (!selection.empty) {
        // console.warn('[SplitCommands] 仅支持在光标处拆分。');
        return false;
      }

      const $from = pos === null || pos === undefined ? selection.$from : state.doc.resolve(pos);
      const currentPos = $from.pos;

      // 1. 验证拆分位置和类型
      if ($from.depth !== 2) { // contentBlock 层级固定为 2 (doc=0, rootBlock=1, contentBlock=2)
        console.warn(`[SplitCommands] 拆分验证失败：操作必须在 contentBlock (深度2)，当前深度为 ${$from.depth}。`);
        return false;
      }

      const currentContentNode = $from.parent; // 当前光标所在的 contentBlock
      const currentContentType = currentContentNode.type;
      const rootNode = $from.node(1); // 当前的 rootBlock

      // 定义允许被拆分的 contentBlock 类型
      // 我们需要一个更精确的列表，排除那些不应通过普通 Enter 拆分的类型 (例如，未来 codeBlock 由其自身处理)
      const allowedContentTypesToSplit = [
        schema.nodes.baseBlock,
        schema.nodes.headingBlock,
        schema.nodes.listItemBlock,
        schema.nodes.quoteBlock,
        // schema.nodes.codeBlock, // codeBlock 会有自己的 Enter 处理逻辑
        // ... 其他允许被此命令拆分的块类型
      ];
      // 也可以从 NODE_GROUPS.BLOCK_CONTENT 动态生成，但硬编码列表更清晰
      // const blockContentNodeNames = NODE_GROUPS.BLOCK_CONTENT.split('|').map(name => name.trim());
      // const allowedContentTypesToSplit = blockContentNodeNames
      // .map(name => schema.nodes[name])
      // .filter(type => type && type.name !== 'codeBlock'); // 示例：排除 codeBlock
      
      if (!allowedContentTypesToSplit.includes(currentContentType)) {
        console.warn(`[SplitCommands] 拆分验证失败：当前块类型 (${currentContentType.name}) 不允许通过此命令拆分。`);
        return false;
      }
      
      // 如果 currentContentNode 是 isolating (通常不应是这些基本块)
      if (currentContentType.spec.isolating) {
          console.warn(`[SplitCommands] 拆分验证失败：当前块类型 (${currentContentType.name}) 是 isolating。`);
          return false;
      }

      // 2. 确定新块的类型和属性
      let newContentBlockType;
      let newContentBlockAttrs;

      if (currentContentType === schema.nodes.listItemBlock) {
        newContentBlockType = schema.nodes.listItemBlock;
        newContentBlockAttrs = {
          ...currentContentNode.attrs, // 继承如 listType, level
          id: generateBlockId(),       // 新 ID
          blockType: 'listItem',       // 确保 blockType
          // 关键：拆分出的新项不能继承 start。
          // start 仅用于“显式重起一个新有序段”的语义；Enter 出来的新项
          // 应该让装饰插件自动 +1，而不是再次重起。
          start: null,
        };
      } 
      // 在此添加未来对有序列表项的判断
      // else if (currentContentType === schema.nodes.orderedListItemBlock) { ... }
      else {
        // 其他所有允许拆分的块，拆分后都变成 baseBlock
        newContentBlockType = schema.nodes.baseBlock;
        newContentBlockAttrs = {
          id: generateBlockId(),
          blockType: 'base',
        };
      }

      const typesAfter = [
        { 
          type: schema.nodes.rootBlock, // rootBlock 类型固定
          attrs: { 
            ...(rootNode.attrs || {}),
            id: generateRootBlockId(), // 新 ID
            // Annotation 锚定拆分前的目标块；新产生的右侧块不能复制同一批稳定 ID。
            annotations: [],
          }
        },
        { 
          type: newContentBlockType,
          attrs: newContentBlockAttrs 
        },
      ];

      // 3. 执行拆分
      tr.split(currentPos, 2, typesAfter); // depth 固定为 2
      
      if (dispatch) {
        dispatch(tr.scrollIntoView());
      }
      
      return true;
    } catch (error) {      
      console.error('[SplitCommands] 拆分块时发生错误:', error);
      if (editor && editor.eventBus && editor.eventBus.emit) {
        editor.eventBus.emit('error', {
            source: 'SplitCommands',
            error,
            message: resolveCurrentEditorMessage('editor.command.splitBlock.failed')
        });
      }
      return false;
    }
  };
};
