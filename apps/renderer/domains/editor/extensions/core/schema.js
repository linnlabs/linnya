// src/renderer/extensions/schema.js
/**
 * schema.js
 * 
 * 定义编辑器的节点组和内容规则
 * 这些规则决定了文档的结构和节点之间的关系
 */

/**
 * 节点组定义
 * 用于在内容规则中引用一组节点类型
 * 
 * 文档结构：
 * doc -> rootBlock -> baseBlock|headingBlock|listBlock|... -> text
 */
export const NODE_GROUPS = {
  // 块容器组，包含 rootBlock 节点
  // 这是文档的直接子节点
  BLOCK_CONTAINER: 'rootBlock',
  
  // 块内容组，包含各种块级节点
  // 这些是 rootBlock 的子节点
  // 注意：bibliographyBlock 是系统块（参考文献容器），由 citation 功能自动维护
  BLOCK_CONTENT: 'baseBlock|headingBlock|horizontalRuleBlock|listItemBlock|quoteBlock|codeBlock|latexBlock|table|imageBlock|bibliographyBlock',
  
  // 行内内容组，包含各种行内节点
  // 这些是块级节点的子节点
  INLINE_CONTENT: 'text|hardBreak|mention|emoji',
}

/**
 * 内容规则
 * 定义各种节点类型可以包含的子节点
 */
export const CONTENT_RULES = {
  // 文档只能包含块容器
  DOC: `${NODE_GROUPS.BLOCK_CONTAINER}+`,
  
  // 块容器只能包含一个块内容
  BLOCK_CONTAINER: `${NODE_GROUPS.BLOCK_CONTENT}`,
  
  // 块内容可以包含行内内容
  BLOCK_CONTENT: `${NODE_GROUPS.INLINE_CONTENT}*`,
}

/**
 * 将 schema 规则应用到节点配置
 * 根据节点类型自动应用相应的内容规则
 * 
 * @param {Object} nodeConfig - 节点配置对象
 * @returns {Object} 应用了 schema 规则的节点配置
 */
export const applySchemaToNode = (nodeConfig) => {
  const { name } = nodeConfig;
  
  // 根据节点名称应用相应的内容规则
  if (name === 'doc') {
    return {
      ...nodeConfig,
      content: CONTENT_RULES.DOC,
    };
  }
  
  if (NODE_GROUPS.BLOCK_CONTAINER.includes(name)) {
    return {
      ...nodeConfig,
      content: CONTENT_RULES.BLOCK_CONTAINER,
    };
  }
  
  if (NODE_GROUPS.BLOCK_CONTENT.split('|').includes(name)) {
    return {
      ...nodeConfig,
      content: CONTENT_RULES.BLOCK_CONTENT,
    };
  }
  
  // 如果没有匹配的规则，返回原始配置
  return nodeConfig;
};

/**
 * 打印节点组和内容规则，用于调试
 */
export const printSchemaRules = () => {
  // 移除调试日志
  // console.group('编辑器 Schema 规则')
  // console.log('节点组:')
  // Object.entries(NODE_GROUPS).forEach(([key, value]) => {
  //   console.log(`  ${key}: ${value}`)
  // })
  // 
  // console.log('内容规则:')
  // Object.entries(CONTENT_RULES).forEach(([key, value]) => {
  //   console.log(`  ${key}: ${value}`)
  // })
  // console.groupEnd()
}

// 初始化时打印 schema 规则
if (import.meta.env.DEV) {
  // 移除调试日志
  // console.log('加载 schema.js')
  // printSchemaRules()
}

export default {
  NODE_GROUPS,
  CONTENT_RULES,
  printSchemaRules,
  applySchemaToNode,
}
