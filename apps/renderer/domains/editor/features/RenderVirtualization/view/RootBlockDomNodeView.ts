import type { Node as ProseMirrorNode } from 'prosemirror-model'
import type { Decoration, DecorationSource, NodeView } from 'prosemirror-view'
import {
  recordRootBlockNodeViewMounted,
  recordRootBlockNodeViewUnmounted,
} from '../debug/rootBlockNodeViewRuntimePerf'
import {
  publishRootBlockNodeViewMounted,
  publishRootBlockNodeViewUnmounted,
} from '../state/nodeViewLifecycle'
import {
  registerRootBlockRuntimeHandle,
  type RootBlockRuntimeRegistryOwner,
  type RootBlockRuntimeHandle,
} from '../runtime/RootBlockRuntimeRegistry'
import {
  readExplicitRootBlockRenderModeFromDecorations,
  type RootBlockRenderMode,
} from './rootBlockRenderMode'
import { readRootBlockAttrs, readRootBlockId } from '../functions/readRootBlockAttrs'
import { setOptionalAttribute } from './nodeViewDomUtils'
import {
  ROOT_BLOCK_DOM_ATTRS,
  ROOT_BLOCK_DOM_CLASSES,
  ROOT_BLOCK_DOM_NODE_TYPES,
  ROOT_BLOCK_DOM_RENDER_MODES,
  applyRootBlockColorStyle,
  clearRootBlockContentClasses,
  createHydratedRootBlockDomShellElements,
  getRootBlockContentClass,
  type RootBlockDomShellElements,
} from '../../../shared/rootBlockDomContract'

export interface RootBlockDomNodeViewOptions {
  getPos?: () => number
  runtimeRegistryOwner: RootBlockRuntimeRegistryOwner
  resolveMode?: (
    node: ProseMirrorNode,
    decorations: readonly unknown[] | undefined
  ) => RootBlockRenderMode
}

interface NodeViewMutationRecordLike {
  type: string
  target: Node
}

function resolveRenderMode(
  node: ProseMirrorNode,
  decorations: readonly unknown[] | undefined,
  options: RootBlockDomNodeViewOptions
): RootBlockRenderMode {
  return (
    options.resolveMode?.(node, decorations) ??
    readExplicitRootBlockRenderModeFromDecorations(decorations) ??
    'hydrated'
  )
}

function isMutationInsideContentDom(
  mutation: NodeViewMutationRecordLike,
  contentDOM: HTMLElement
): boolean {
  if (mutation.type === 'selection') return true
  const target = mutation.target
  return target === contentDOM || contentDOM.contains(target)
}

function syncRootBlockDom(shell: RootBlockDomShellElements, node: ProseMirrorNode): void {
  const attrs = readRootBlockAttrs(node)
  const id = readRootBlockId(node) ?? ''

  shell.dom.setAttribute(ROOT_BLOCK_DOM_ATTRS.nodeType, ROOT_BLOCK_DOM_NODE_TYPES.outer)
  shell.dom.setAttribute(ROOT_BLOCK_DOM_ATTRS.renderMode, ROOT_BLOCK_DOM_RENDER_MODES.hydrated)
  shell.dom.setAttribute(ROOT_BLOCK_DOM_ATTRS.placeholder, 'false')
  setOptionalAttribute(shell.dom, ROOT_BLOCK_DOM_ATTRS.id, id)
  setOptionalAttribute(shell.dom, ROOT_BLOCK_DOM_ATTRS.position, attrs.position)
  setOptionalAttribute(shell.dom, ROOT_BLOCK_DOM_ATTRS.dragging, attrs.isDragging ? 'true' : null)
  setOptionalAttribute(shell.dom, ROOT_BLOCK_DOM_ATTRS.backgroundColor, attrs.backgroundColor)
  setOptionalAttribute(shell.dom, ROOT_BLOCK_DOM_ATTRS.textColor, attrs.textColor)

  clearRootBlockContentClasses(shell.dom)
  shell.dom.classList.add(ROOT_BLOCK_DOM_CLASSES.outer, ROOT_BLOCK_DOM_CLASSES.hydrated)
  shell.dom.classList.remove(
    ROOT_BLOCK_DOM_CLASSES.placeholder,
    ROOT_BLOCK_DOM_CLASSES.virtualPlaceholder
  )
  const contentClass = getRootBlockContentClass(node.firstChild?.type.name)
  if (contentClass) shell.dom.classList.add(contentClass)

  shell.rootBlockEl.setAttribute(ROOT_BLOCK_DOM_ATTRS.nodeType, ROOT_BLOCK_DOM_NODE_TYPES.body)
  applyRootBlockColorStyle(shell.rootBlockEl, attrs)
}

function safelyReadRootBlockPos(getPos: (() => number) | undefined): number | null {
  if (!getPos) return null
  try {
    const pos = getPos()
    return Number.isFinite(pos) ? pos : null
  } catch {
    // ProseMirror 在 NodeView 重建边界会让 getPos 暂时不可用。
    return null
  }
}

function createRuntimeHandle(
  blockId: string,
  shell: RootBlockDomShellElements,
  getPos: (() => number) | undefined,
  isDestroyed: () => boolean
): RootBlockRuntimeHandle {
  return {
    blockId,
    mode: 'hydrated',
    getDom: () => shell.dom,
    getContentDom: () => shell.contentDOM,
    getChromeAnchor: () => shell.chromeAnchorEl,
    getRevisionHeaderMount: () => shell.revisionHeaderEl,
    getPos: () => (isDestroyed() ? null : safelyReadRootBlockPos(getPos)),
    getRect: () => shell.dom.getBoundingClientRect(),
    measure: () => Math.max(0, shell.dom.getBoundingClientRect().height),
  }
}

export function createRootBlockDomNodeView(
  node: ProseMirrorNode,
  options: RootBlockDomNodeViewOptions
): NodeView {
  let currentNode = node
  let currentBlockId = readRootBlockId(currentNode) ?? ''
  let destroyed = false

  const shell = createHydratedRootBlockDomShellElements()
  const { dom, contentDOM } = shell

  let unregisterRuntimeHandle: (() => void) | null = null

  function registerRuntime(): void {
    unregisterRuntimeHandle?.()
    unregisterRuntimeHandle = registerRootBlockRuntimeHandle(
      createRuntimeHandle(currentBlockId, shell, options.getPos, () => destroyed),
      options.runtimeRegistryOwner
    )
  }

  function publishMounted(): void {
    publishRootBlockNodeViewMounted(
      {
        blockId: currentBlockId,
        mode: 'hydrated',
        dom,
      },
      options.runtimeRegistryOwner
    )
  }

  function sync(nextNode: ProseMirrorNode): void {
    const previousBlockId = currentBlockId
    currentNode = nextNode
    currentBlockId = readRootBlockId(currentNode) ?? ''
    syncRootBlockDom(shell, currentNode)

    if (currentBlockId === previousBlockId) return

    publishRootBlockNodeViewUnmounted(
      {
        blockId: previousBlockId,
        mode: 'hydrated',
        dom,
      },
      options.runtimeRegistryOwner
    )
    recordRootBlockNodeViewUnmounted({
      kind: 'dom',
      blockId: previousBlockId,
    })
    registerRuntime()
    recordRootBlockNodeViewMounted({
      kind: 'dom',
      blockId: currentBlockId,
    })
    publishMounted()
  }

  const view: NodeView = {
    dom,
    contentDOM,
    update(
      nextNode: ProseMirrorNode,
      decorations?: readonly Decoration[],
      _innerDecorations?: DecorationSource
    ) {
      if (nextNode.type !== currentNode.type) return false
      if (resolveRenderMode(nextNode, decorations, options) !== 'hydrated') return false
      sync(nextNode)
      return true
    },
    selectNode() {
      dom.classList.add(ROOT_BLOCK_DOM_CLASSES.selected)
    },
    deselectNode() {
      dom.classList.remove(ROOT_BLOCK_DOM_CLASSES.selected)
    },
    ignoreMutation(mutation: NodeViewMutationRecordLike) {
      return !isMutationInsideContentDom(mutation, contentDOM)
    },
    destroy() {
      destroyed = true
      unregisterRuntimeHandle?.()
      unregisterRuntimeHandle = null
      publishRootBlockNodeViewUnmounted(
        {
          blockId: currentBlockId,
          mode: 'hydrated',
          dom,
        },
        options.runtimeRegistryOwner
      )
      recordRootBlockNodeViewUnmounted({
        kind: 'dom',
        blockId: currentBlockId,
      })
    },
  }

  syncRootBlockDom(shell, currentNode)
  registerRuntime()
  publishMounted()
  recordRootBlockNodeViewMounted({
    kind: 'dom',
    blockId: currentBlockId,
  })

  return view
}
