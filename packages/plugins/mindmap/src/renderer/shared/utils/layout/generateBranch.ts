import type { MindMapInstance } from '../../../domain/types/index'
import { DirectionClass } from '../../../domain/types/index'
import { drawSmoothManhattan } from '../svg/pathGenerator'

export interface MainLineParams {
  pT: number
  pL: number
  pW: number
  pH: number
  cT: number
  cL: number
  cW: number
  cH: number
  direction: DirectionClass
  containerHeight: number
}

export interface SubLineParams {
  pT: number
  pL: number
  pW: number
  pH: number
  cT: number
  cL: number
  cW: number
  cH: number
  direction: DirectionClass
}

export function main({ pT, pL, pW, pH, cT, cL, cW, cH, direction, containerHeight }: MainLineParams) {
  const x1 = direction === DirectionClass.LEFT ? pL : pL + pW
  const y1 = pT + pH / 2
  const x2 = direction === DirectionClass.LEFT ? cL + cW : cL
  const y2 = cT + cH / 2

  const dx = Math.abs(x2 - x1)
  if (dx < 1) {
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }

  const pct = Math.abs(y2 - y1) / Math.max(containerHeight, 1)
  const directionSign = direction === DirectionClass.LEFT ? -1 : 1
  const hub = Math.max(10, Math.min(dx * 0.2, 110)) * (1 - pct * 0.1)
  // 让根节点发出的线进入子节点前有更长的水平段
  const entryPad = clamp(dx * 0.20, 20, 60)
  const preEntryX = x2 - entryPad * directionSign

  const points = [
    { x: x1, y: y1 }, // 边缘起点
    { x: x1 + hub * directionSign, y: y1 }, // 放射 hub
    { x: preEntryX, y: y2 }, // 斜向散射到节点侧边附近
    { x: x2, y: y2 }, // 水平贴边进入节点
  ]

  return roundedPolyline(points, computeRadius(Math.abs(y2 - y1)))
}

export function sub(
  this: MindMapInstance,
  { pT, pL, pW, pH, cT, cL, cW, cH, direction }: SubLineParams
) {
  const computedStyle = getComputedStyle(this.container)
  const gapX =
    parseInt(computedStyle.getPropertyValue('--node-gap-x')) ||
    parseInt(this.container.style.getPropertyValue('--node-gap-x')) ||
    0
  const y1 = pT + pH / 2
  const y2 = cT + cH / 2

  const x1 = direction === DirectionClass.LEFT ? pL : pL + pW
  const x2 = direction === DirectionClass.LEFT ? cL + cW : cL
  const distance = Math.abs(x2 - x1)

  // 如果水平距离不足以容纳平滑折线，回退到直线
  if (distance < 6) {
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }

  const radius = clamp(gapX * 0.6, 10, gapX * 0.9)
  const minDistanceForCurve = radius * 2 + 12
  if (distance <= minDistanceForCurve) {
    return `M ${x1} ${y1} L ${x2} ${y2}`
  }

  // stump 统一采用基于 gapX 的固定值，确保同一层的弯曲幅度一致
  const desiredStump = gapX * 1.1
  const maxStump = distance - radius - 6
  const stump = clamp(desiredStump, radius + 6, maxStump)

  return drawSmoothManhattan(x1, y1, x2, y2, resolveDirection(direction), {
    stump,
    r: radius,
  })
}

function resolveDirection(direction: DirectionClass): 'lhs' | 'rhs' {
  return direction === DirectionClass.LEFT ? 'lhs' : 'rhs'
}

function computeRadius(dy: number) {
  return clamp(Math.abs(dy) * 0.25, 8, 42)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

interface Point {
  x: number
  y: number
}

/**
 * Round the polyline corners with quadratic curves so that lines stick to edges,
 * flow through a junction, then fan out smoothly.
 */
function roundedPolyline(points: Point[], radius: number) {
  if (points.length < 2) {
    return ''
  }

  let path = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const next = points[i + 1]

    if (!next) {
      path += ` L ${curr.x} ${curr.y}`
      break
    }

    const r = Math.min(
      radius,
      distance(prev, curr) / 2,
      distance(curr, next) / 2
    )

    const p1 = moveTowards(curr, prev, r)
    const p2 = moveTowards(curr, next, r)

    path += ` L ${p1.x} ${p1.y} Q ${curr.x} ${curr.y} ${p2.x} ${p2.y}`
  }

  return path
}

function distance(a: Point, b: Point) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.sqrt(dx * dx + dy * dy)
}

function moveTowards(from: Point, to: Point, dist: number): Point {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const len = Math.sqrt(dx * dx + dy * dy) || 1
  const ratio = dist / len
  return {
    x: from.x + dx * ratio,
    y: from.y + dy * ratio,
  }
}
