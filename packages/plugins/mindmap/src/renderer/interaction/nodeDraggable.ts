import type { Topic } from '../domain/types/dom'
import type { MindMapInstance } from '../domain/types/index'
import { on } from '../shared/utils/dom'
import { isInteractiveElement, shouldIgnoreDrag } from '../shared/utils/interactionGate'
type InsertType = 'before' | 'after' | 'in' | null
const $d = document

type DragGhost = {
  root: HTMLDivElement
  icon: SVGSVGElement
  label: HTMLSpanElement
}

type LastMouseDownSnapshot = {
  atPerfMs: number
  isInInteractive: boolean
  targetTag: string
  targetClass?: string
}

/**
 * 获取拖拽 ghost 上展示的文本。
 * 说明：
 * - 不能用 innerHTML：会把图标/标签等 HTML 一并塞进 ghost，样式容易“脏”，还可能引入不可控布局。
 * - 优先使用 `Topic.text`（mm-topic 的核心文本容器），拿到更干净的纯文本。
 */
const getTopicGhostText = (topic: Topic): string => {
  const raw = topic.text?.textContent ?? topic.textContent ?? ''
  return raw.trim()
}

/**
 * 创建 “AddCircleIcon” 对应的 SVG 元素（与 `@linnya/renderer-ui/icons` 保持一致）。
 * 说明：drag ghost 是原生 DOM，不适合直接 mount Vue 组件；这里用同款 SVG Path 来渲染。
 */
const createAddCircleIconSvg = (): SVGSVGElement => {
  const svgNs = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(svgNs, 'svg')
  svg.setAttribute('xmlns', svgNs)
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  const path = document.createElementNS(svgNs, 'path')
  path.setAttribute(
    'd',
    'M8,12c0-.28.22-.5.5-.5h3v-3c0-.28.22-.5.5-.5s.5.22.5.5v3h3c.28,0,.5.22.5.5s-.22.5-.5.5h-3v3c0,.28-.22.5-.5.5s-.5-.22-.5-.5v-3h-3c-.28,0-.5-.22-.5-.5ZM12,20c4.42,0,8-3.58,8-8s-3.58-8-8-8S4,7.58,4,12s3.58,8,8,8ZM12,19c-3.87,0-7-3.13-7-7s3.13-7,7-7,7,3.13,7,7-3.13,7-7,7Z'
  )
  path.setAttribute('fill', 'currentColor')
  svg.appendChild(path)

  return svg
}
const insertPreview = function (tpc: Topic, insertTpye: InsertType) {
  if (!insertTpye) {
    clearPreview(tpc)
    return tpc
  }
  let el = tpc.querySelector('.insert-preview')
  const className = `insert-preview ${insertTpye} show`
  if (!el) {
    el = $d.createElement('div')
    tpc.appendChild(el)
  }
  el.className = className
  return tpc
}

const clearPreview = function (el: Element | null) {
  if (!el) return
  const query = el.querySelectorAll('.insert-preview')
  for (const queryElement of query || []) {
    queryElement.remove()
  }
}

const canMove = function (el: Element, dragged: Topic[]) {
  for (const node of dragged) {
    const isContain = node.parentElement.parentElement.contains(el)
    const ok = el && el.tagName === 'MM-TOPIC' && el !== node && !isContain && (el as Topic).nodeObj.parent
    if (!ok) return false
  }
  return true
}

const createGhost = function (mind: MindMapInstance): DragGhost {
  const root = document.createElement('div')
  root.className = 'mind-map-ghost'

  const icon = createAddCircleIconSvg()
  icon.classList.add('mind-map-ghost__icon')

  const label = document.createElement('span')
  label.className = 'mind-map-ghost__label'

  root.appendChild(icon)
  root.appendChild(label)
  mind.container.appendChild(root)

  return { root, icon, label }
}

class EdgeMoveController {
  private mind: MindMapInstance
  private isMoving = false
  private interval: NodeJS.Timeout | null = null
  private speed = 20
  constructor(mind: MindMapInstance) {
    this.mind = mind
  }
  move(dx: number, dy: number) {
    if (this.isMoving) return
    this.isMoving = true
    this.interval = setInterval(() => {
      this.mind.move(dx * this.speed * this.mind.scaleVal, dy * this.speed * this.mind.scaleVal)
    }, 100)
  }
  stop() {
    this.isMoving = false
    clearInterval(this.interval!)
  }
}

export default function (mind: MindMapInstance) {
  let insertTpye: InsertType = null
  let meet: Topic | null = null
  const ghost = createGhost(mind)
  const edgeMoveController = new EdgeMoveController(mind)
  let draggingNodeEls: Array<HTMLElement> = []

  /**
   * 最近一次鼠标按下的快照（用于拦截“在 addon 内拖拽却触发节点拖拽”）
   *
   * 中文说明（根因修复）：
   * - HTML5 dragstart 事件的 target 往往是 draggable 元素本身（mm-topic），无法反推出“最初按下的子元素”
   * - 因此这里用 mousedown 记录真实起点：如果起点在 data-mm-interactive 区域，则 dragstart 必须被阻止
   */
  let lastMouseDown: LastMouseDownSnapshot | null = null

  function resolveEventTargetElement(evt: Event): HTMLElement | null {
    const t = evt.target
    if (t instanceof HTMLElement) return t
    // 中文说明：在文本框选/拖拽场景，event.target 可能是 Text 节点
    if (t instanceof Node) {
      const el = (t as Node).parentElement
      return el instanceof HTMLElement ? el : null
    }
    return null
  }

  const handleMouseDown = (e: MouseEvent) => {
    const target = resolveEventTargetElement(e)
    if (!target) {
      lastMouseDown = null
      return
    }

    const gateDebugEnabled = mind.bus.debug.interactionGate.isEnabled()
    const inInteractive = isInteractiveElement(
      { target, event: e, boundary: mind.container },
      { debug: gateDebugEnabled }
    )

    lastMouseDown = {
      atPerfMs: performance.now(),
      isInInteractive: inInteractive,
      targetTag: target.tagName,
      targetClass: typeof target.className === 'string' ? target.className : undefined,
    }
  }

  const handleDragStart = (e: DragEvent) => {
    // 当按下空格键或开启移动模式时，阻止节点拖拽
    if (mind.spacePressed || mind.moveMode) {
      e.preventDefault()
      return
    }

    const target = e.target as HTMLElement

    // 中文说明（根因修复）：
    // - 若最近一次 mousedown 起点在交互区（addon 内），则禁止启动节点拖拽（允许用户框选文本复制）
    // - 否则用户在 addon 内一拖就触发 drag ghost，看到“为什么”等节点文本，属于误触
    if (lastMouseDown) {
      const ageMs = performance.now() - lastMouseDown.atPerfMs
      // 经验阈值：dragstart 与 mousedown 通常在很短时间内关联
      if (lastMouseDown.isInInteractive && ageMs >= 0 && ageMs < 1000) {
        e.preventDefault()
        return
      }
    }

    // 中文说明：
    // - 使用 InteractionGate 统一判断是否应该忽略拖拽
    // - 如果目标是交互元素（按钮/输入框等），不触发节点拖拽
    const gateDebugEnabled = mind.bus.debug.interactionGate.isEnabled()
    if (shouldIgnoreDrag({ target, event: e, boundary: mind.container }, { debug: gateDebugEnabled })) {
      e.preventDefault()
      return
    }

    // 原生 drag&drop 开始后，浏览器可能不再派发 mouseup，从而导致框选引擎无法自然 stop。
    // 所以这里必须强制 cancel + disable，确保不会出现“选框一直跟随鼠标”的悬挂状态。
    mind.selection?.cancel(false)
    mind.selection?.disable()
    const topicTarget = target as Topic
    if (topicTarget?.tagName !== 'MM-TOPIC') {
      // it should be a topic element, return if not
      e.preventDefault()
      return
    }
    let nodes = mind.currentNodes
    if (!nodes?.includes(topicTarget)) {
      mind.selectNode(topicTarget)
      nodes = mind.currentNodes
    }
    mind.dragged = nodes
    if (nodes.length > 1) {
      ghost.label.textContent = String(nodes.length)
    } else {
      ghost.label.textContent = getTopicGhostText(topicTarget)
    }

    // 拖拽样式：用 class 控制，避免到处写 inline style（更好维护、也更容易统一视觉）
    draggingNodeEls = nodes
      .map(node => node.parentElement as unknown as HTMLElement)
      .filter(Boolean)
    for (const el of draggingNodeEls) {
      el.classList.add('mm-node--dragging')
    }
    mind.container.classList.add('mm-dragging')
    e.dataTransfer!.setDragImage(ghost.root, 0, 0)
    // 关键：绿色“+”通常代表 copy。这里强制 move，尽量让系统光标反馈变成移动而不是复制。
    // 注意：部分浏览器只有在 setData 之后才会正确应用 dropEffect/effectAllowed。
    e.dataTransfer!.effectAllowed = 'move'
    e.dataTransfer!.dropEffect = 'move'
    e.dataTransfer!.setData('text/plain', '')
    mind.dragMoveHelper.clear()
  }
  const handleDragEnd = (e: DragEvent) => {
    const { dragged } = mind
    if (!dragged) return
    edgeMoveController.stop()
    // 清理拖拽样式
    for (const el of draggingNodeEls) {
      el.classList.remove('mm-node--dragging')
    }
    draggingNodeEls = []
    mind.container.classList.remove('mm-dragging')

    // 重新启用框选引擎（拖拽结束后恢复正常交互）
    mind.selection?.enable()
    const target = e.target as Topic
    target.style.opacity = ''
    if (!meet) return
    clearPreview(meet)

    // Phase 3 WP3-4：拖拽提交命令化
    // 把直接调用 mind.moveNodeBefore/After/In 改为调用 mind.commands.node.move
    // 这样可以：
    // - 贯通 txId/source/traceId 链路
    // - 在 history 中记录 commandMeta
    // - 支持 TxRecorder 聚合
    if (insertTpye && meet) {
      const fromNodeIds = dragged.map((t) => t.nodeObj.id)
      const toNodeId = meet.nodeObj.id

      // 调用命令（source 为 mouse，因为是拖拽触发）
      mind.commands.node.move(
        {
          fromNodeIds,
          toNodeId,
          position: insertTpye,
        },
        { source: 'mouse' }
      )
    }

    mind.dragged = null
    ghost.label.textContent = ''
  }
  const handleDragOver = (e: DragEvent) => {
    e.preventDefault()
    // dragover 阶段也要持续指定 dropEffect，否则浏览器可能回退到默认 copy 光标（绿色“+”）。
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'move'
    }
    const threshold = 12 * mind.scaleVal
    const { dragged } = mind

    if (!dragged) return

    // border detection
    const rect = mind.container.getBoundingClientRect()
    if (e.clientX < rect.x + 50) {
      edgeMoveController.move(1, 0)
    } else if (e.clientX > rect.x + rect.width - 50) {
      edgeMoveController.move(-1, 0)
    } else if (e.clientY < rect.y + 50) {
      edgeMoveController.move(0, 1)
    } else if (e.clientY > rect.y + rect.height - 50) {
      edgeMoveController.move(0, -1)
    } else {
      edgeMoveController.stop()
    }

    clearPreview(meet)
    // minus threshold infer that postion of the cursor is above topic
    const topMeet = $d.elementFromPoint(e.clientX, e.clientY - threshold) as Topic
    if (canMove(topMeet, dragged)) {
      meet = topMeet
      const rect = topMeet.getBoundingClientRect()
      const y = rect.y
      if (e.clientY > y + rect.height) {
        insertTpye = 'after'
      } else {
        insertTpye = 'in'
      }
    } else {
      const bottomMeet = $d.elementFromPoint(e.clientX, e.clientY + threshold) as Topic
      const rect = bottomMeet.getBoundingClientRect()
      if (canMove(bottomMeet, dragged)) {
        meet = bottomMeet
        const y = rect.y
        if (e.clientY < y) {
          insertTpye = 'before'
        } else {
          insertTpye = 'in'
        }
      } else {
        insertTpye = meet = null
      }
    }
    if (meet) insertPreview(meet, insertTpye)
  }
  // 中文说明：用 capture 监听 mousedown，避免 addon 内部 stopPropagation 导致我们拿不到“真实起点”
  mind.container.addEventListener('mousedown', handleMouseDown, true)

  const off = on([
    { dom: mind.map, evt: 'dragstart', func: handleDragStart },
    { dom: mind.map, evt: 'dragend', func: handleDragEnd },
    { dom: mind.map, evt: 'dragover', func: handleDragOver },
  ])

  return () => {
    mind.container.removeEventListener('mousedown', handleMouseDown, true)
    off()
  }
}
