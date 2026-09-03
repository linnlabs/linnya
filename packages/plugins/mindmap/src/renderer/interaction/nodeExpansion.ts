import { rmSubline } from '../domain/operations/nodeOperations'
import type { Topic, Wrapper, Expander } from '../domain/types/dom'
import type { MindMapInstance } from '../domain/types/index'
import { setExpand } from '../shared/utils/index'
import { applyExpanderState } from '../shared/utils/dom/expanderRenderer'

export const expandNode = function (this: MindMapInstance, el: Topic, isExpand?: boolean) {
  const node = el.nodeObj
  // 中文说明：expanded 的“展开口径”与渲染一致：`expanded !== false` 视为展开
  const originExpanded = node.expanded !== false
  if (typeof isExpand === 'boolean') {
    node.expanded = isExpand
  } else if (node.expanded !== false) {
    node.expanded = false
  } else {
    node.expanded = true
  }
  const nextExpanded = node.expanded !== false

  const expanderRect = el.getBoundingClientRect()
  const beforePosition = {
    x: expanderRect.left,
    y: expanderRect.top,
  }

  const parent = el.parentElement
  if (!parent) return
  const parentWrapper = parent.parentElement
  if (!parentWrapper) return
  const expander = parent.children[1] as Expander | undefined
  if (!expander) return
  applyExpanderState(expander, node.expanded ?? true)

  rmSubline(el)
  if (node.expanded) {
    const children = this.createChildren(
      node.children!.map(child => {
        const wrapper = this.createWrapper(child)
        return wrapper.grp
      })
    )
    parentWrapper.appendChild(children)
  } else {
    const children = parentWrapper.children[1]
    children?.remove()
  }

  // 中文说明：
  // - 这里必须“立即”重算连线：后面需要通过 afterRect 计算 driftX/driftY，并进行视图位移补偿
  // - 如果改成 requestReflow（rAF 合并），会导致测量发生在重算之前，从而漂移补偿计算错误
  // - 因此这里使用 requestReflowNow（属于内核交互流程的“强时序”点位，见 docs/MINDMAP_DEV_GUIDE.md）
  this.requestReflowNow('node-expansion:toggle')

  const afterRect = el.getBoundingClientRect()
  const afterPosition = {
    x: afterRect.left,
    y: afterRect.top,
  }

  const driftX = beforePosition.x - afterPosition.x
  const driftY = beforePosition.y - afterPosition.y

  this.move(driftX, driftY)

  /**
   * operation（进入 history/dirty 链路）
   *
   * 根因说明：
   * - 之前 expand/collapse 只 fire state:nodeExpanded，不会进入 operation 链路；
   * - 结果：file-manager 的 dirty 不会被置位，`ai-invoke` 的预保存会被跳过，
   *   导致 AutoRefresh 全量重载后“展开状态被关回去”。
   *
   * 约束：
   * - operation payload 必须满足 eventBus 的 runtime 守卫，否则会被丢弃；
   * - 这里不传 DOM，只传 NodeObj 与布尔状态。
   */
  this.bus.fire('operation', {
    name: 'toggleExpand',
    obj: node,
    originExpanded,
    expanded: nextExpanded,
  })

  // 中文说明：迁移到 state:* 新事件名（事件契约）
  this.bus.fire('state:nodeExpanded', node)
}

export const expandNodeAll = function (this: MindMapInstance, el: Topic, isExpand?: boolean) {
  const node = el.nodeObj
  const beforeRect = el.getBoundingClientRect()
  const beforePosition = {
    x: beforeRect.left,
    y: beforeRect.top,
  }
  setExpand(node, isExpand ?? !node.expanded)
  this.refresh()
  const target = this.findEle(node.id)
  const afterRect = target.getBoundingClientRect()
  const afterPosition = {
    x: afterRect.left,
    y: afterRect.top,
  }
  const driftX = beforePosition.x - afterPosition.x
  const driftY = beforePosition.y - afterPosition.y

  this.move(driftX, driftY)
}
