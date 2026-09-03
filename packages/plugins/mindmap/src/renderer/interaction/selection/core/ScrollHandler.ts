import type { AreaLocation, Coordinates, ScrollEvent, SelectionOptions } from './types'
import { selectionGeometry } from '../utils'

const { abs, min, max } = Math
const { domRect } = selectionGeometry

/**
 * 负责滚动状态与计算，不处理事件分发或渲染。
 */
export default class ScrollHandler {
  private _scrollAvailable = true
  private _scrollingActive = false
  private _scrollSpeed: Coordinates = { x: 0, y: 0 }
  private _scrollDelta: Coordinates = { x: 0, y: 0 }
  private _lastMousePosition: Coordinates = { x: 0, y: 0 }

  constructor(private readonly getOptions: () => SelectionOptions) {}

  get scrollAvailable(): boolean {
    return this._scrollAvailable
  }

  set scrollAvailable(value: boolean) {
    this._scrollAvailable = value
  }

  get scrollingActive(): boolean {
    return this._scrollingActive
  }

  set scrollingActive(value: boolean) {
    this._scrollingActive = value
  }

  get scrollSpeed(): Coordinates {
    return this._scrollSpeed
  }

  resetScrollSpeed(): void {
    this._scrollSpeed.x = 0
    this._scrollSpeed.y = 0
    this._scrollingActive = false
  }

  get scrollDelta(): Coordinates {
    return this._scrollDelta
  }

  set scrollDelta(delta: Coordinates) {
    this._scrollDelta = delta
  }

  updateLastMousePosition(x: number, y: number): void {
    this._lastMousePosition = { x, y }
  }

  handleWheelScroll(evt: ScrollEvent, onTapMove: (evt: ScrollEvent) => void): void {
    const {
      behaviour: { scrolling },
    } = this.getOptions()

    // Consistent scrolling speed on all browsers
    const deltaY = evt.deltaY ? (evt.deltaY > 0 ? 1 : -1) : 0
    const deltaX = evt.deltaX ? (evt.deltaX > 0 ? 1 : -1) : 0
    this._scrollSpeed.y += deltaY * scrolling.manualSpeed
    this._scrollSpeed.x += deltaX * scrolling.manualSpeed
    onTapMove(evt)

    // Prevent default scrolling behavior, e.g. page scrolling
    evt.preventDefault()
  }

  handleKeyboardScroll(evt: KeyboardEvent, onTapMove: (evt: ScrollEvent) => void): void {
    const {
      behaviour: { scrolling },
    } = this.getOptions()

    const deltaX = evt.key === 'ArrowLeft' ? -1 : evt.key === 'ArrowRight' ? 1 : 0
    const deltaY = evt.key === 'ArrowUp' ? -1 : evt.key === 'ArrowDown' ? 1 : 0

    this._scrollSpeed.x += Math.sign(deltaX) * scrolling.manualSpeed
    this._scrollSpeed.y += Math.sign(deltaY) * scrolling.manualSpeed

    evt.preventDefault()

    onTapMove({
      clientX: this._lastMousePosition.x,
      clientY: this._lastMousePosition.y,
      preventDefault: () => void 0,
    } as ScrollEvent)
  }

  recalculateSelectionAreaRect(areaLocation: AreaLocation, targetRect: DOMRect): DOMRect {
    const options = this.getOptions()
    const scrollSpeed = this._scrollSpeed

    const { x1, y1 } = areaLocation
    let { x2, y2 } = areaLocation

    const {
      behaviour: {
        scrolling: { startScrollMargins },
      },
    } = options

    // 检查是否达到边界并计算滚动速度
    if (x2 < targetRect.left + startScrollMargins.x) {
      scrollSpeed.x = -abs(targetRect.left - x2 + startScrollMargins.x)
      x2 = x2 < targetRect.left ? targetRect.left : x2
    } else if (x2 > targetRect.right - startScrollMargins.x) {
      scrollSpeed.x = abs(targetRect.left + targetRect.width - x2 - startScrollMargins.x)
      x2 = x2 > targetRect.right ? targetRect.right : x2
    } else {
      scrollSpeed.x = 0
    }

    if (y2 < targetRect.top + startScrollMargins.y) {
      scrollSpeed.y = -abs(targetRect.top - y2 + startScrollMargins.y)
      y2 = y2 < targetRect.top ? targetRect.top : y2
    } else if (y2 > targetRect.bottom - startScrollMargins.y) {
      scrollSpeed.y = abs(targetRect.top + targetRect.height - y2 - startScrollMargins.y)
      y2 = y2 > targetRect.bottom ? targetRect.bottom : y2
    } else {
      scrollSpeed.y = 0
    }

    const x3 = min(x1, x2)
    const y3 = min(y1, y2)
    const x4 = max(x1, x2)
    const y4 = max(y1, y2)

    areaLocation.x2 = x2
    areaLocation.y2 = y2

    return domRect(x3, y3, x4 - x3, y4 - y3)
  }
}
