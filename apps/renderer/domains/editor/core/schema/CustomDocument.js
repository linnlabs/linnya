// src/renderer/extensions/CustomDocument.js
/**
 * CustomDocument.js
 * 
 * 自定义文档节点扩展，确保文档只接受 blockContainer 类型的子节点
 * 这样可以强制文档结构符合我们的预期：doc -> rootBlock -> baseBlock
 */

import { Document } from '@tiptap/extension-document'
import { NODE_GROUPS } from '../../extensions/core/schema'

/**
 * 自定义文档节点扩展
 * 覆盖默认的 Document 扩展，确保文档只能包含 blockContainer 组的节点
 */
export const CustomDocument = Document.extend({
  name: 'doc',
  
  // 关键设置：文档只能包含 blockContainer 组的节点（即 rootBlock）
  content: `${NODE_GROUPS.BLOCK_CONTAINER}+`,
  
  // 添加调试信息
  addProseMirrorPlugins() {
    const originalPlugins = Document.config.addProseMirrorPlugins?.call(this) || []
    
    console.log('自定义文档节点已注册，内容规则:', `${NODE_GROUPS.BLOCK_CONTAINER}+`)
    console.log('允许的子节点组:', NODE_GROUPS.BLOCK_CONTAINER)
    
    // 打印 schema 信息
    console.group('文档 Schema 信息')
    console.log('文档内容规则:', this.content)
    console.log('rootBlock 节点类型:', NODE_GROUPS.BLOCK_CONTAINER)
    console.log('baseBlock 节点类型:', NODE_GROUPS.BLOCK_CONTENT)
    console.groupEnd()
    
    return [
      ...originalPlugins,
    ]
  },
})

export default CustomDocument 