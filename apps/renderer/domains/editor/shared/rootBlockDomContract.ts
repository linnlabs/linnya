import type { Node as ProseMirrorNode } from 'prosemirror-model'
import { ROOT_BLOCK_CONTENT_ATTRS, resolveRootBlockContentAttributes } from '@linnya/markdown-document-core/workspace-presentation'
export { resolveRootBlockColorStyle, applyRootBlockColorStyle, resolveRootBlockContentAttributes } from '@linnya/markdown-document-core/workspace-presentation'
export type { RootBlockColorAttributes } from '@linnya/markdown-document-core/workspace-presentation'

// RootBlock DOM 是虚拟化、旧 Vue NodeView、schema 序列化和 Host chrome 的共同契约。
// 这些字符串必须集中维护，避免某条渲染路径悄悄漂移后只在大文档或小文档里回归。
export const ROOT_BLOCK_DOM_CLASSES = {
  outer: 'root-block-outer',
  body: 'root-block',
  content: 'content',
  chromeAnchor: 'root-block-chrome-anchor',
  revisionHeader: 'root-block-revision-header',
  hydrated: 'is-hydrated',
  placeholder: 'is-placeholder',
  virtualPlaceholder: 'root-block-virtual-placeholder',
  selected: 'is-block-selected',
} as const

export const ROOT_BLOCK_DOM_ATTRS = {
  id: 'data-id',
  nodeType: 'data-node-type',
  placeholder: 'data-placeholder',
  renderMode: 'data-root-block-render-mode',
  position: 'data-position',
  dragging: 'data-dragging',
  backgroundColor: 'data-background-color',
  textColor: 'data-text-color',
  chromeAnchor: 'data-root-block-chrome-anchor',
  revisionHeaderMount: 'data-root-block-revision-header-mount',
  historyMount: 'data-root-block-history-mount',
  ...ROOT_BLOCK_CONTENT_ATTRS,
} as const

export const ROOT_BLOCK_DOM_NODE_TYPES = {
  outer: 'rootBlockOuter',
  body: 'rootBlock',
} as const

export const ROOT_BLOCK_DOM_RENDER_MODES = {
  hydrated: 'hydrated',
  placeholder: 'placeholder',
} as const

export const ROOT_BLOCK_OUTER_SELECTOR =
  `.${ROOT_BLOCK_DOM_CLASSES.outer}[${ROOT_BLOCK_DOM_ATTRS.id}]`

export const ROOT_BLOCK_PLACEHOLDER_SELECTOR =
  `.${ROOT_BLOCK_DOM_CLASSES.outer}.${ROOT_BLOCK_DOM_CLASSES.virtualPlaceholder}[${ROOT_BLOCK_DOM_ATTRS.id}]`


export interface RootBlockDomShellElements {
  dom: HTMLDivElement
  chromeAnchorEl: HTMLDivElement
  rootBlockEl: HTMLDivElement
  revisionHeaderEl: HTMLDivElement
  contentDOM: HTMLDivElement
  historyMountEl: HTMLDivElement
}


export function getRootBlockContentClass(firstChildTypeName: string | null | undefined): string {
  return firstChildTypeName ? `contains-${firstChildTypeName}` : ''
}

/**
 * 排版只投影内容节点的语义，不新增持久化属性。
 * 离屏块没有 contentDOM，因此标题与列表间距不能依赖 :has(内部内容)。
 */

export function applyRootBlockContentAttributes(
  dom: HTMLElement,
  content: ProseMirrorNode | null | undefined
): void {
  const attributes = resolveRootBlockContentAttributes(content)
  for (const name of [ROOT_BLOCK_DOM_ATTRS.contentType, ROOT_BLOCK_DOM_ATTRS.headingLevel, ROOT_BLOCK_DOM_ATTRS.listType]) {
    const value = attributes[name]
    // 块转换时移除旧标题/列表语义，避免沿用转换前的章节留白。
    if (value === undefined) dom.removeAttribute(name)
    else dom.setAttribute(name, value)
  }
}

export function clearRootBlockContentClasses(el: HTMLElement): void {
  Array.from(el.classList).forEach((className) => {
    if (className.startsWith('contains-')) el.classList.remove(className)
  })
}

export function createRootBlockOuterElement(): HTMLDivElement {
  const dom = document.createElement('div')
  dom.className = ROOT_BLOCK_DOM_CLASSES.outer
  return dom
}

export function createRootBlockBodyElement(): HTMLDivElement {
  const rootBlockEl = document.createElement('div')
  rootBlockEl.className = ROOT_BLOCK_DOM_CLASSES.body
  rootBlockEl.setAttribute(ROOT_BLOCK_DOM_ATTRS.nodeType, ROOT_BLOCK_DOM_NODE_TYPES.body)
  return rootBlockEl
}

export function createRootBlockChromeAnchorElement(): HTMLDivElement {
  const chromeAnchorEl = document.createElement('div')
  chromeAnchorEl.className = ROOT_BLOCK_DOM_CLASSES.chromeAnchor
  chromeAnchorEl.contentEditable = 'false'
  chromeAnchorEl.setAttribute(ROOT_BLOCK_DOM_ATTRS.chromeAnchor, 'true')
  return chromeAnchorEl
}

export function createRootBlockRevisionHeaderMountElement(): HTMLDivElement {
  const revisionHeaderEl = document.createElement('div')
  revisionHeaderEl.className = ROOT_BLOCK_DOM_CLASSES.revisionHeader
  revisionHeaderEl.contentEditable = 'false'
  revisionHeaderEl.setAttribute(ROOT_BLOCK_DOM_ATTRS.revisionHeaderMount, 'true')
  return revisionHeaderEl
}

export function createRootBlockContentElement(): HTMLDivElement {
  const contentDOM = document.createElement('div')
  contentDOM.className = ROOT_BLOCK_DOM_CLASSES.content
  return contentDOM
}

export function createRootBlockHistoryMountElement(): HTMLDivElement {
  const historyMountEl = document.createElement('div')
  historyMountEl.contentEditable = 'false'
  historyMountEl.setAttribute(ROOT_BLOCK_DOM_ATTRS.historyMount, 'true')
  return historyMountEl
}

export function createHydratedRootBlockDomShellElements(): RootBlockDomShellElements {
  const dom = createRootBlockOuterElement()
  const chromeAnchorEl = createRootBlockChromeAnchorElement()
  const rootBlockEl = createRootBlockBodyElement()
  const revisionHeaderEl = createRootBlockRevisionHeaderMountElement()
  const contentDOM = createRootBlockContentElement()
  const historyMountEl = createRootBlockHistoryMountElement()

  rootBlockEl.append(chromeAnchorEl, revisionHeaderEl, contentDOM, historyMountEl)
  dom.append(rootBlockEl)

  return {
    dom,
    chromeAnchorEl,
    rootBlockEl,
    revisionHeaderEl,
    contentDOM,
    historyMountEl,
  }
}
