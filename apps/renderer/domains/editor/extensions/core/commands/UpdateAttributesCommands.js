// src/renderer/extensions/interaction/commands/UpdateAttributesCommands.js
/**
 * UpdateAttributesCommands.js
 * 
 * 提供更新节点属性的命令
 * 这些命令用于在文档中更新节点的属性
 */

/**
 * 更新节点属性
 * @param {String} nodeType - 节点类型
 * @param {Number} pos - 节点位置
 * @param {Object} newAttrs - 新的属性
 * @returns {Function} - 返回命令函数
 */
export const updateNodeAttributes = (nodeType, pos, newAttrs) => (props) => {
  const { state, dispatch } = props;
  const { tr } = state;

  // 更新节点的属性
  tr.setNodeMarkup(pos, undefined, {
    ...state.doc.nodeAt(pos).attrs,
    ...newAttrs
  });

  // 如果有更改，执行事务
  if (tr.docChanged) {
    dispatch(tr);
    return true;
  }
  return false;
};

// 导出所有命令
export default {
  updateNodeAttributes
}; 