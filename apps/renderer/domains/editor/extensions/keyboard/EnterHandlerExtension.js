// src/renderer/shared/extensions/keyboard/EnterHandlerExtension.js

import { Extension } from '@tiptap/core';
import { NodeSelection, TextSelection } from 'prosemirror-state';

/**
 * 这是一个专门处理 Enter 键在特定场景下行为的扩展。
 * 主要解决：当一个包含原子节点的块被选中时，按Enter键在其后插入新行。
 */
export const EnterHandlerExtension = Extension.create({
  name: 'enterHandler',

  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { state, dispatch } = this.editor.view;
        const { selection } = state;

        // 仅当选区是节点选区时生效
        if (!(selection instanceof NodeSelection)) {
          return false;
        }

        const selectedNode = selection.node;
        // 检查选中的是否是 RootBlock (移除对原子节点的检查，使其对所有块生效)
        if (selectedNode.type.name === 'rootBlock') {
          // 在选中节点的末尾位置之后插入一个新的默认块 (rootBlock > baseBlock)
          const endPos = selection.to;
          
          // 获取当前事务
          const { tr } = state;
          
          // 创建一个新的 rootBlock，包含一个空的 baseBlock
          const newBlock = state.schema.nodes.rootBlock.create(null, 
            state.schema.nodes.baseBlock.create()
          );

          // 插入新块
          tr.insert(endPos, newBlock);
          
          // 将光标移动到新创建的块中 (+2 是为了跳过 rootBlock 和 baseBlock 的起始标签)
          const newSelection = TextSelection.create(tr.doc, endPos + 2);
          tr.setSelection(newSelection).scrollIntoView();

          // 应用事务
          if (dispatch) {
            dispatch(tr);
          }
          
          return true; // 阻止默认行为
        }

        return false; // 其他情况，不处理
      },
    };
  },
}); 