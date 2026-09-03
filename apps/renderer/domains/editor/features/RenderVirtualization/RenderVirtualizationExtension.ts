import { Extension } from '@tiptap/core'
import { createRenderVirtualizationPlugin } from './state/renderVirtualizationPlugin'

/**
 * RenderVirtualizationExtension
 *
 * 中文说明：
 * - 只负责把 ProseMirror plugin 注册进编辑器；
 * - plugin 初始状态默认 disabled，不会改变普通文档行为；
 * - 是否启用由文档加载链路在首次 direct-state 渲染前写入 plugin state。
 */
export const RenderVirtualizationExtension = Extension.create({
  name: 'renderVirtualization',

  addProseMirrorPlugins() {
    return [createRenderVirtualizationPlugin()]
  },
})

export default RenderVirtualizationExtension
