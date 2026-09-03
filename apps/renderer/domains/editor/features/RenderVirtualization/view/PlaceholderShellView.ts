import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { NodeView } from 'prosemirror-view'
import { DEFAULT_PLACEHOLDER_ROOT_BLOCK_HEIGHT } from '../renderVirtualizationConstants'
import {
  readExplicitRootBlockRenderModeFromDecorations,
  type RootBlockRenderMode,
} from './rootBlockRenderMode'
import {
  publishRootBlockNodeViewMounted,
  publishRootBlockNodeViewUnmounted,
} from '../state/nodeViewLifecycle'
import { readRootBlockAttrs, readRootBlockId } from '../functions/readRootBlockAttrs'
import { setOptionalAttribute } from './nodeViewDomUtils'
import type { RenderVirtualizationOwner } from '../definitions/renderVirtualizationOwner'
import {
  ROOT_BLOCK_DOM_ATTRS,
  ROOT_BLOCK_DOM_CLASSES,
  ROOT_BLOCK_DOM_NODE_TYPES,
  ROOT_BLOCK_DOM_RENDER_MODES,
  createRootBlockBodyElement,
} from '../../../shared/rootBlockDomContract'

/**
 * PlaceholderShellView
 *
 * 离屏 rootBlock 的占位 NodeView。
 *
 * 中文说明：
 * - 这个 NodeView 故意不暴露 contentDOM，核心目的就是阻止 ProseMirror 继续为离屏块
 *   创建 baseBlock / text / marks 的 ViewDesc 子树；
 * - 它只维持 rootBlock 的块级 DOM、id 和估算高度；
 * - mode 从 decoration 读取，mode 变化时返回 false，交给 ProseMirror 按官方契约重建。
 */

interface PlaceholderShellViewOptions {
  estimatedHeight?: number
  runtimeRegistryOwner: RenderVirtualizationOwner
  resolveMode?: (
    node: ProseMirrorNode,
    decorations: readonly unknown[] | undefined
  ) => RootBlockRenderMode
}

function getRootBlockId(node: ProseMirrorNode): string {
  return readRootBlockId(node) ?? ''
}

function syncPlaceholderDom(dom: HTMLElement, node: ProseMirrorNode, height: number): void {
  const attrs = readRootBlockAttrs(node)
  const id = getRootBlockId(node)

  dom.classList.add(
    ROOT_BLOCK_DOM_CLASSES.outer,
    ROOT_BLOCK_DOM_CLASSES.placeholder,
    ROOT_BLOCK_DOM_CLASSES.virtualPlaceholder
  )
  dom.classList.remove(ROOT_BLOCK_DOM_CLASSES.hydrated)
  dom.setAttribute(ROOT_BLOCK_DOM_ATTRS.nodeType, ROOT_BLOCK_DOM_NODE_TYPES.outer)
  dom.setAttribute(ROOT_BLOCK_DOM_ATTRS.placeholder, 'true')
  dom.setAttribute(ROOT_BLOCK_DOM_ATTRS.renderMode, ROOT_BLOCK_DOM_RENDER_MODES.placeholder)
  setOptionalAttribute(dom, ROOT_BLOCK_DOM_ATTRS.id, id)
  setOptionalAttribute(dom, ROOT_BLOCK_DOM_ATTRS.position, attrs.position)
  setOptionalAttribute(dom, ROOT_BLOCK_DOM_ATTRS.backgroundColor, attrs.backgroundColor)
  setOptionalAttribute(dom, ROOT_BLOCK_DOM_ATTRS.textColor, attrs.textColor)

  dom.style.minHeight = `${Math.max(1, Math.round(height))}px`
}

export function createPlaceholderShellView(
  node: ProseMirrorNode,
  options: PlaceholderShellViewOptions
): NodeView {
  let currentNode = node
  const height = options.estimatedHeight ?? DEFAULT_PLACEHOLDER_ROOT_BLOCK_HEIGHT

  const dom = document.createElement('div')
  dom.contentEditable = 'false'
  const visualBlock = createRootBlockBodyElement()
  visualBlock.setAttribute('aria-hidden', 'true')
  dom.appendChild(visualBlock)

  syncPlaceholderDom(dom, currentNode, height)

  const view: NodeView = {
    dom,
    update(nextNode, decorations) {
      if (nextNode.type !== currentNode.type) return false

      const mode =
        options.resolveMode?.(nextNode, decorations) ??
        readExplicitRootBlockRenderModeFromDecorations(decorations) ??
        'placeholder'
      if (mode !== 'placeholder') return false

      currentNode = nextNode
      syncPlaceholderDom(dom, currentNode, height)
      publishRootBlockNodeViewMounted(
        {
          blockId: getRootBlockId(currentNode),
          mode: 'placeholder',
          dom,
        },
        options.runtimeRegistryOwner
      )
      return true
    },
    ignoreMutation() {
      return true
    },
    destroy() {
      // ProseMirror 会负责移除 NodeView DOM。这里保持空实现，避免文档切换时主动清空仍在树上的旧 DOM。
      publishRootBlockNodeViewUnmounted(
        {
          blockId: getRootBlockId(currentNode),
          mode: 'placeholder',
          dom,
        },
        options.runtimeRegistryOwner
      )
    },
  }

  publishRootBlockNodeViewMounted(
    {
      blockId: getRootBlockId(currentNode),
      mode: 'placeholder',
      dom,
    },
    options.runtimeRegistryOwner
  )
  return view
}
