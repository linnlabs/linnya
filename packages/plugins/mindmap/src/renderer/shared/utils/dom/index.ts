import type { Topic, Wrapper, Parent, Children, Expander, CustomSvg } from '../../../domain/types/dom'
import type { MindMapInstance, NodeObj } from '../../../domain/types/index'
import { encodeHTML } from '../common/index'
import { layoutChildren } from '../layout'
import { applyExpanderState } from './expanderRenderer'
import { toDomNodeId } from './nodeId'

// DOM helpers from original utils/index.ts
export const getOffsetLT = (parent: HTMLElement, child: HTMLElement) => {
  let offsetLeft = 0
  let offsetTop = 0
  while (child && child !== parent) {
    offsetLeft += child.offsetLeft
    offsetTop += child.offsetTop
    child = child.offsetParent as HTMLElement
  }
  return { offsetLeft, offsetTop }
}

export const setAttributes = (el: HTMLElement | SVGElement, attrs: { [key: string]: string }) => {
  for (const key in attrs) {
    el.setAttribute(key, attrs[key])
  }
}

export const isTopic = (target?: HTMLElement): target is Topic => {
  return target ? target.tagName === 'MM-TOPIC' : false
}

export const unionTopics = (nodes: Topic[]) => {
  const uniqueNodes: Topic[] = []
  const seen = new Set<Topic>()
  for (const node of nodes) {
    if (!seen.has(node)) {
      seen.add(node)
      uniqueNodes.push(node)
    }
  }

  return uniqueNodes
    .filter(node => node.nodeObj.parent)
    .filter((node, _, list) => {
      const parent = node.nodeObj.parent
      return !list.some(other => other !== node && other.nodeObj === parent)
    })
}

export const getTranslate = (styleText: string) => {
  const regex = /translate\(([^,]+),\s*([^)]+)\)/
  const match = styleText.match(regex)
  return match ? { x: parseFloat(match[1]), y: parseFloat(match[2]) } : { x: 0, y: 0 }
}

export const on = function (
  list: {
    [K in keyof GlobalEventHandlersEventMap]: {
      dom: EventTarget
      evt: K
      func: (this: EventTarget, ev: GlobalEventHandlersEventMap[K]) => void
    }
  }[keyof GlobalEventHandlersEventMap][]
) {
  for (let i = 0; i < list.length; i++) {
    const { dom, evt, func } = list[i]
    dom.addEventListener(evt, func as EventListener)
  }
  return function off() {
    for (let i = 0; i < list.length; i++) {
      const { dom, evt, func } = list[i]
      dom.removeEventListener(evt, func as EventListener)
    }
  }
}

// Core DOM manipulation from utils/dom.ts
const $d = document
const RICH_CONTENT_HOST_CLASS = 'rich-content-host'
export const findEle = function (this: MindMapInstance, id: string, el?: HTMLElement) {
  const scope = this?.el ? this.el : el ? el : document
  const ele = scope.querySelector<Topic>(`[data-nodeid="${toDomNodeId(id)}"]`)
  if (!ele) throw new Error(`FindEle: Node ${id} not found, maybe it's collapsed.`)
  return ele
}

export const shapeTpc = function (this: MindMapInstance, tpc: Topic, nodeObj: NodeObj) {
  /**
   * 中文说明（根因修复）：
   * - 节点 addons（引用/打标徽章/未来扩展）通过 `NodeAddonsHost` Teleport 到 `.mm-topic-addons` 容器。
   * - 旧实现 `tpc.innerHTML = ''` 会把 `.mm-topic-addons` 一并销毁，Teleport 的目标节点丢失，
   *   而 `NodeAddonsHost` 的 renderItems 计算不会因为 DOM mutation 自动重算，导致“引用突然消失”。
   * - 因此这里必须 **保留并复用** `.mm-topic-addons` 容器（保持 targetEl 稳定），只更新其 data-nodeid。
   */
  const preservedAddonsEl = tpc.addons

  /**
   * - `.mm-topic-addons` 的唯一权威引用是 `tpc.addons`（由 shapeTpc 维护）。
   * - 如果这里为 undefined，说明某处破坏了契约（例如绕过 shapeTpc 手动改 DOM、或外部错误清空了字段）。
   * - 我们不做“查 DOM 再捞回来”的兜底恢复，以免隐藏根因；开发态直接抛错。
   */
  if (import.meta.env.MODE !== 'production') {
    if (!preservedAddonsEl && tpc.childElementCount > 0) {
      // childElementCount > 0 且 addons 丢失，通常意味着“已有节点被 reshape，但 addons 引用没了”
      throw new Error('[shapeTpc] invariant broken: tpc.addons is missing on existing topic node')
    }
  }

  // 先把 addons 从 DOM 中摘出来，避免被清空流程误删
  if (preservedAddonsEl && preservedAddonsEl.parentElement === tpc) {
    tpc.removeChild(preservedAddonsEl)
  }

  // 清空 topic 内容（不包含 preservedAddonsEl）
  while (tpc.firstChild) {
    tpc.removeChild(tpc.firstChild)
  }

  // richContent 生命周期：topic 结构清空后通知卸载（与旧时序保持一致）
  if (this.bus) {
    this.bus.fire('richContentUnmount', { nodeId: nodeObj.id })
  }

  if (nodeObj.style) {
    const style = nodeObj.style
    type KeyOfStyle = keyof typeof style
    for (const key in style) {
      tpc.style[key as KeyOfStyle] = style[key as KeyOfStyle]!
    }
  }

  /**
   * 内容渲染模式
   *
   * 中文说明：
   * - richContent / dangerouslySetInnerHTML 原本会 `return` 早退，不渲染默认 topic 内容（text/link/tags...）
   * - 我们需要保持该语义不变，但同时必须在末尾追加 addons 容器（引用等扩展仍应可用）
   */
  const richContent = nodeObj.richContent
  const dangerousHtml = nodeObj.dangerouslySetInnerHTML
  const contentMode: 'normal' | 'richContent' | 'dangerousHtml' = (() => {
    if (richContent) return 'richContent'
    if (dangerousHtml) return 'dangerousHtml'
    return 'normal'
  })()

  if (contentMode === 'richContent') {
    // 中文说明：按契约，进入此分支时 richContent 必须存在；不做静默兜底，开发态保持可观测
    if (!richContent) {
      throw new Error('[shapeTpc] invariant broken: contentMode=richContent but nodeObj.richContent is empty')
    }
    const host = $d.createElement('div')
    host.className = RICH_CONTENT_HOST_CLASS
    /**
     * 中文说明（DOM 属性统一规范）：
     * - 所有 DOM 元素的 data-nodeid 统一使用 domId（me 前缀）
     * - 事件 payload 中传递业务 nodeId（从 nodeObj.id 获取）
     * - 这样保证：DOM 层一致性 + 跨层接口纯净性
     */
    host.dataset.nodeid = toDomNodeId(nodeObj.id)
    tpc.appendChild(host)
    this.bus?.fire('richContentMount', {
      node: nodeObj,
      host,
      descriptor: richContent,
    })
  } else if (contentMode === 'dangerousHtml') {
    // 中文说明：按契约，进入此分支时 dangerouslySetInnerHTML 必须存在；不做静默兜底，开发态保持可观测
    if (dangerousHtml === undefined) {
      throw new Error('[shapeTpc] invariant broken: contentMode=dangerousHtml but nodeObj.dangerouslySetInnerHTML is undefined')
    }
    /**
     * 中文说明：
     * - 不能直接 `tpc.innerHTML = ...`，否则会覆盖/破坏 addons 容器与 Teleport target。
     * - 这里用单独的内容容器承载 HTML，并继续在末尾追加 addons 容器。
     */
    const htmlHost = $d.createElement('div')
    htmlHost.className = 'mm-topic-html-host'
    htmlHost.innerHTML = dangerousHtml
    tpc.appendChild(htmlHost)
  } else {
    if (nodeObj.image) {
      const img = nodeObj.image
      if (img.url && img.width && img.height) {
        const imgEl = $d.createElement('img')
        // Use imageProxy function if provided, otherwise use original URL
        imgEl.src = this.imageProxy ? this.imageProxy(img.url) : img.url
        imgEl.style.width = img.width + 'px'
        imgEl.style.height = img.height + 'px'
        if (img.fit) imgEl.style.objectFit = img.fit
        tpc.appendChild(imgEl)
        tpc.image = imgEl
      } else {
        console.warn('Image url/width/height are required')
      }
    } else if (tpc.image) {
      tpc.image = undefined
    }

    {
      const textEl = $d.createElement('span')
      textEl.className = 'text'

      // Check if markdown parser is provided and topic contains markdown syntax
      if (this.markdown) {
        textEl.innerHTML = this.markdown(nodeObj.topic, nodeObj)
      } else {
        textEl.textContent = nodeObj.topic
      }

      tpc.appendChild(textEl)
      tpc.text = textEl
    }

    if (nodeObj.hyperLink) {
      const linkEl = $d.createElement('a')
      linkEl.className = 'hyper-link'
      linkEl.target = '_blank'
      linkEl.innerText = '🔗'
      linkEl.href = nodeObj.hyperLink
      tpc.appendChild(linkEl)
      tpc.link = linkEl
    } else if (tpc.link) {
      tpc.link = undefined
    }

    if (nodeObj.icons && nodeObj.icons.length) {
      const iconsEl = $d.createElement('span')
      iconsEl.className = 'icons'
      iconsEl.innerHTML = nodeObj.icons.map(icon => `<span>${encodeHTML(icon)}</span>`).join('')
      tpc.appendChild(iconsEl)
      tpc.icons = iconsEl
    } else if (tpc.icons) {
      tpc.icons = undefined
    }

    if (nodeObj.tags && nodeObj.tags.length) {
      const tagsEl = $d.createElement('div')
      tagsEl.className = 'tags'

      nodeObj.tags.forEach(tag => {
        const span = $d.createElement('span')

        if (typeof tag === 'string') {
          span.textContent = tag
        } else {
          span.textContent = tag.text
          if (tag.className) {
            span.className = tag.className
          }
          if (tag.style) {
            Object.assign(span.style, tag.style)
          }
        }

        tagsEl.appendChild(span)
      })

      tpc.appendChild(tagsEl)
      tpc.tags = tagsEl
    } else if (tpc.tags) {
      tpc.tags = undefined
    }
  }

  /**
   * 节点内部扩展区域（插件挂载点）
   *
   * 中文说明：
   * - 统一在每个 topic 内创建一个 addons 容器，供 feature UI 使用 Teleport 挂载。
   * - 该容器默认为空，不影响现有渲染与交互。
   * - feature 在该容器内渲染内容时，节点尺寸会真实变化，mindmap layout 会以 DOM 尺寸为准重排。
   * - data-nodeid 统一使用 domId（me${id}），保证 DOM 层标识一致性
   */
  const addonsEl = preservedAddonsEl ?? $d.createElement('div')
  addonsEl.className = 'mm-topic-addons'
  addonsEl.dataset.nodeid = toDomNodeId(nodeObj.id)
  /**
   * 交互门禁（基础设施默认行为）
   *
   * 中文说明：
   * - addons 容器承载节点内部 UI（引用/卡片/未来扩展）
   * - 必须阻止节点拖拽/画布拖拽/滚轮缩放等全局交互穿透，允许在内部选中文本复制
   * - 交互过滤统一由 InteractionGate 基于 data-mm-interactive 处理
   */
  addonsEl.setAttribute('data-mm-interactive', 'true')
  tpc.appendChild(addonsEl)
  tpc.addons = addonsEl
}

// everything start from `Wrapper`
export const createWrapper = function (this: MindMapInstance, nodeObj: NodeObj, omitChildren?: boolean) {
  const grp = $d.createElement('mm-wrapper') as Wrapper
  const { p, tpc } = this.createParent(nodeObj)
  grp.appendChild(p)
  if (!omitChildren && nodeObj.children && nodeObj.children.length > 0) {
    const expander = createExpander(this, nodeObj)
    p.appendChild(expander)
    tpc.expander = expander
    if (nodeObj.expanded !== false) {
      const children = layoutChildren(this, nodeObj.children)
      grp.appendChild(children)
    }
  }
  return { grp, top: p, tpc }
}

export const createParent = function (this: MindMapInstance, nodeObj: NodeObj) {
  const p = $d.createElement('mm-node') as Parent
  const tpc = this.createTopic(nodeObj)
  shapeTpc.call(this, tpc, nodeObj)
  p.appendChild(tpc)
  return { p, tpc }
}

export const createChildren = function (this: MindMapInstance, wrappers: Wrapper[]) {
  const children = $d.createElement('mm-children') as Children
  children.append(...wrappers)
  return children
}

export const createTopic = function (this: MindMapInstance, nodeObj: NodeObj) {
  const topic = $d.createElement('mm-topic') as Topic
  topic.nodeObj = nodeObj
  topic.dataset.nodeid = toDomNodeId(nodeObj.id)
  topic.draggable = this.draggable
  return topic
}

export function selectText(element: HTMLElement) {
  const range = document.createRange()
  range.selectNodeContents(element)
  const selection = window.getSelection()
  if (selection) {
    selection.removeAllRanges()
    selection.addRange(range)
  }
}

export const editTopic = function (this: MindMapInstance, el: Topic) {
  if (!el) return

  const node = el.nodeObj
  const { offsetLeft, offsetTop } = getOffsetLT(this.nodes, el)
  const style = getComputedStyle(el)
  const textEl = el.querySelector('.text') as HTMLElement | null
  const textStyle = textEl ? getComputedStyle(textEl) : style

  // 中文说明：优先发纯 payload 事件（不透传 HTMLElement）
  this.bus.fire('ui:startNodeEdit', {
    nodeId: node.id,
    trigger: 'mouse',
  })

  this.bus.fire('operation', {
    name: 'beginEdit',
    obj: el.nodeObj,
  })
}

export const createExpander = function (
  mind: MindMapInstance,
  nodeObj: NodeObj,
  expandedOverride?: boolean
): Expander {
  const expanded = typeof expandedOverride === 'boolean' ? expandedOverride : nodeObj.expanded !== false
  const expander = mind.renderers.expander({
    mind,
    node: nodeObj,
    expanded,
  })
  applyExpanderState(expander, expanded)
  return expander
}
