import type { MindMapInstance } from '../domain/types/index'
import { getTranslate } from '../shared/utils/index'
import { flickerLog } from '../shared/utils/debug/flickerDebug'

const getCenterDefault = (mind: MindMapInstance) => {
  const { container, map, nodes, alignment } = mind
  const root = map.querySelector('mm-root') as HTMLElement
  const pT = root.offsetTop
  const pL = root.offsetLeft
  const pW = root.offsetWidth
  const pH = root.offsetHeight

  let dx: number
  let dy: number
  if (alignment === 'root') {
    dx = container.offsetWidth / 2 - pL - pW / 2
    dy = container.offsetHeight / 2 - pT - pH / 2
    map.style.transformOrigin = `${pL + pW / 2}px 50%`
  } else {
    dx = (container.offsetWidth - nodes.offsetWidth) / 2
    dy = (container.offsetHeight - nodes.offsetHeight) / 2
    map.style.transformOrigin = `50% 50%`
  }
  return { dx, dy }
}

export const scrollIntoView = function (
  this: MindMapInstance,
  el: HTMLElement,
  /**
   * 是否使用平滑移动（transform transition）。
   *
   * 中文说明（消除“新增节点闪一下”的根因修复）：
   * - 新增节点（insertSibling/addChild/insertParent）通常会立即选中新节点；
   * - 若新节点恰好在视口外，scrollIntoView 会触发 move(smooth=true) 的 0.3s 动画；
   * - 动画期间节点/连线还可能同步发生几何 flush，用户会感知为“闪一下/抖一下”；
   * - 对“新建节点的自动滚动”我们更希望是稳定、即时定位（无过渡），因此允许调用方关闭 smooth。
   */
  // 中文说明：
  // - 为了“杜绝一切会闪”的体验目标，这里默认关闭 smooth（无 transform transition）。
  // - 若某些交互未来确实需要动画效果，必须由调用方显式传入 smooth=true。
  smooth: boolean = false
) {
  const container = this.container
  const rect = el.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const isOutOfView =
    rect.top > containerRect.bottom ||
    rect.bottom < containerRect.top ||
    rect.left > containerRect.right ||
    rect.right < containerRect.left
  if (!isOutOfView) {
    flickerLog('scrollIntoView skipped (in view)', {
      t: performance.now(),
      smooth,
      transition: this.map?.style?.transition ?? null,
    })
    return
  }
  const elCenterX = rect.left + rect.width / 2
  const elCenterY = rect.top + rect.height / 2
  const containerCenterX = containerRect.left + containerRect.width / 2
  const containerCenterY = containerRect.top + containerRect.height / 2
  const offsetX = elCenterX - containerCenterX
  const offsetY = elCenterY - containerCenterY
  flickerLog('scrollIntoView move', {
    t: performance.now(),
    smooth,
    offsetX,
    offsetY,
    transition: this.map?.style?.transition ?? null,
    transform: this.map?.style?.transform ?? null,
  })
  this.move(-offsetX, -offsetY, smooth)
}

export const scale = function (this: MindMapInstance, scaleVal: number, offset: { x: number; y: number } = { x: 0, y: 0 }) {
  // 中文说明：
  // - 统一把目标缩放值钳制在 [scaleMin, scaleMax] 区间；
  // - 避免“步长跨过边界后直接 return”导致永远到不了最小/最大值。
  const nextScale = Math.min(this.scaleMax, Math.max(this.scaleMin, scaleVal))
  if (nextScale === this.scaleVal) return
  const rect = this.container.getBoundingClientRect()
  const xc = offset.x ? offset.x - rect.left - rect.width / 2 : 0
  const yc = offset.y ? offset.y - rect.top - rect.height / 2 : 0

  const { dx, dy } = getCenterDefault(this)
  const oldTransform = this.map.style.transform
  const { x: xCurrent, y: yCurrent } = getTranslate(oldTransform)
  const xb = xCurrent - dx
  const yb = yCurrent - dy

  const oldScale = this.scaleVal
  const xres = (-xc + xb) * (1 - nextScale / oldScale)
  const yres = (-yc + yb) * (1 - nextScale / oldScale)

  this.map.style.transform = `translate(${xCurrent - xres}px, ${yCurrent - yres}px) scale(${nextScale})`
  this.scaleVal = nextScale
  // 中文说明：迁移到 state:* 新事件名（事件契约）
  this.bus.fire('state:scaleChanged', nextScale)
}

export const scaleFit = function (this: MindMapInstance) {
  const heightPercent = this.nodes.offsetHeight / this.container.offsetHeight
  const widthPercent = this.nodes.offsetWidth / this.container.offsetWidth
  const scale = 1 / Math.max(1, Math.max(heightPercent, widthPercent))
  this.scaleVal = scale
  this.map.style.transform = `scale(${scale})`
  this.bus.fire('state:scaleChanged', scale)
}

export const move = function (this: MindMapInstance, dx: number, dy: number, smooth = false) {
  const { map, scaleVal, bus } = this
  const transform = map.style.transform
  let { x, y } = getTranslate(transform)
  x += dx
  y += dy

  const transitionBefore = map.style.transition
  if (smooth) {
    map.style.transition = 'transform 0.3s'
    setTimeout(() => {
      map.style.transition = 'none'
    }, 300)
  } else {
    // 中文说明（根因修复：杜绝残留 transition 导致的“闪一下”）：
    // - 即使本次 move 调用传入 smooth=false，如果此前某次 smooth move 的 300ms 还没结束，
    //   map.style.transition 仍可能是 'transform 0.3s'，会把本次 transform 也动画化；
    // - 这会在“新建兄弟节点 -> 自动 scrollIntoView”场景里表现为视口抖动/闪烁；
    // - 因此只要 smooth=false，就强制清除 transition，保证 transform 立即生效。
    map.style.transition = 'none'
  }
  map.style.transform = `translate(${x}px, ${y}px) scale(${scaleVal})`
  flickerLog('move', {
    t: performance.now(),
    smooth,
    dx,
    dy,
    transitionBefore: transitionBefore || null,
    transitionAfter: map.style.transition || null,
    transform: map.style.transform || null,
  })
  bus.fire('state:viewMoved', { dx, dy })
}

export const toCenter = function (this: MindMapInstance) {
  const { map, container } = this
  // 中文说明：
  // - toCenter() 会直接写 transform（不是通过 move），历史上不会触发 state:viewMoved
  // - 但从“状态广播契约”角度，视口确实发生了变化；外部（如 store 的 viewport 缓存）需要可观测信号
  // - 因此这里补发一次 state:viewMoved（用 delta 语义保持与 move() 一致）
  const { x: xBefore, y: yBefore } = getTranslate(map.style.transform || '')
  const { dx, dy } = getCenterDefault(this)
  container.scrollTop = 0
  container.scrollLeft = 0
  map.style.transform = `translate(${dx}px, ${dy}px) scale(${this.scaleVal})`
  this.bus.fire('state:viewMoved', { dx: dx - xBefore, dy: dy - yBefore })
}
