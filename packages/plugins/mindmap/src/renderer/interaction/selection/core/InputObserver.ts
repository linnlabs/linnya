import { EventTarget } from './EventEmitter'
import { selectionEvents } from '../utils'
import type { Coordinates } from './types'

const { on, off, simplifyEvent } = selectionEvents
const { abs } = Math

export interface InputObserverOptions {
  startThreshold: number | Coordinates
  document: Document
  startAreas: string | HTMLElement | ReadonlyArray<string | HTMLElement>
  filterTarget?: (target: HTMLElement, evt: MouseEvent | TouchEvent) => boolean
}

export type InputEvents = {
  down: (evt: MouseEvent | TouchEvent) => void
  start: (evt: MouseEvent | TouchEvent) => void
  move: (evt: MouseEvent | TouchEvent) => void
  stop: (evt: MouseEvent | TouchEvent) => void
  tap: (evt: MouseEvent | TouchEvent) => void
  scroll: (evt: Event) => void
}

export class InputObserver extends EventTarget<InputEvents> {
  private _options: InputObserverOptions
  private _startCoordinates: Coordinates = { x: 0, y: 0 }
  private _isDragging = false
  /**
   * 标记当前是否处于“按下后监听中”的生命周期。
   * 用于在外部强制取消（例如原生 drag&drop 吃掉 mouseup）时，
   * 正确解绑 document 上的 move/up 监听，避免选框继续跟随鼠标。
   */
  private _isTracking = false
  private _boundHandlers: {
    delayedMove: (evt: MouseEvent | TouchEvent) => void
    move: (evt: MouseEvent | TouchEvent) => void
    up: (evt: MouseEvent | TouchEvent) => void
    scroll: (evt: Event) => void
  }

  constructor(options: InputObserverOptions) {
    super()
    this._options = options
    
    // Bind methods to maintain 'this' context
    this._onDown = this._onDown.bind(this)
    this._onDelayedMove = this._onDelayedMove.bind(this)
    this._onMove = this._onMove.bind(this)
    this._onUp = this._onUp.bind(this)
    this._onScroll = this._onScroll.bind(this)

    this._boundHandlers = {
      delayedMove: this._onDelayedMove,
      move: this._onMove,
      up: this._onUp,
      scroll: this._onScroll
    }
  }

  public enable(): void {
    const { startAreas, document } = this._options
    const areas = Array.isArray(startAreas) ? startAreas : [startAreas]
    
    areas.forEach(area => {
      const el = typeof area === 'string' ? document.querySelector(area) : area
      if (el) {
        on(el as Element, ['mousedown', 'touchstart'], this._onDown)
      }
    })
  }

  public disable(): void {
    const { startAreas, document } = this._options
    const areas = Array.isArray(startAreas) ? startAreas : [startAreas]
    
    areas.forEach(area => {
      const el = typeof area === 'string' ? document.querySelector(area) : area
      if (el) {
        off(el as Element, ['mousedown', 'touchstart'], this._onDown)
      }
    })
    this._cleanup()
  }

  public setOptions(options: Partial<InputObserverOptions>): void {
    this._options = { ...this._options, ...options }
  }

  private _onDown(evt: MouseEvent | TouchEvent): void {
    // Filter target if needed
    if (this._options.filterTarget) {
        const target = evt.target as HTMLElement
        if (!this._options.filterTarget(target, evt)) {
            return
        }
    }

    const { x, y } = simplifyEvent(evt)
    this._startCoordinates = { x, y }
    this._isDragging = false
    this._isTracking = true

    this.emit('down', evt)

    const { document } = this._options
    
    // Bind move and up listeners
    on(document, ['mousemove', 'touchmove'], this._boundHandlers.delayedMove, { passive: false })
    on(document, ['mouseup', 'touchcancel', 'touchend'], this._boundHandlers.up)
  }

  private _onDelayedMove(evt: MouseEvent | TouchEvent): void {
    const { startThreshold, document } = this._options
    const { x, y } = simplifyEvent(evt)
    const { x: x1, y: y1 } = this._startCoordinates

    const deltaX = abs(x - x1)
    const deltaY = abs(y - y1)

    const passedThreshold = 
      (typeof startThreshold === 'number' && abs(x + y - (x1 + y1)) >= startThreshold) ||
      (typeof startThreshold === 'object' && deltaX >= (startThreshold as Coordinates).x) ||
      (typeof startThreshold === 'object' && deltaY >= (startThreshold as Coordinates).y)

    if (passedThreshold) {
      this._isDragging = true
      
      // Unbind delayed move, bind actual move
      off(document, ['mousemove', 'touchmove'], this._boundHandlers.delayedMove, { passive: false })
      on(document, ['mousemove', 'touchmove'], this._boundHandlers.move, { passive: false })

      // Emit drag start
      this.emit('start', evt)
      
      // Immediately trigger first move
      this._onMove(evt)
    }
  }

  private _onMove(evt: MouseEvent | TouchEvent): void {
    if (this._isDragging) {
      this.emit('move', evt)
    }
  }

  private _onUp(evt: MouseEvent | TouchEvent): void {
    this._cleanup()

    if (this._isDragging) {
      this.emit('stop', evt)
    } else {
      this.emit('tap', evt)
    }
    
    this._isDragging = false
  }

  private _onScroll(evt: Event): void {
      this.emit('scroll', evt)
  }

  private _cleanup(): void {
    const { document } = this._options
    // 注意：此处保持与 bind 时一致的 options（passive: false），确保在所有实现中都能移除监听
    off(document, ['mousemove', 'touchmove'], this._boundHandlers.delayedMove, { passive: false })
    off(document, ['mousemove', 'touchmove'], this._boundHandlers.move, { passive: false })
    off(document, ['mouseup', 'touchcancel', 'touchend'], this._boundHandlers.up)
    this._isTracking = false
  }

  /**
   * 强制取消当前输入生命周期（不依赖 mouseup/touchend）。
   * 典型场景：原生 drag&drop 开始后，浏览器可能不再派发 mouseup，
   * 这会导致 selection 的 move 监听长期挂在 document 上，产生“选框一直跟随鼠标”的问题。
   */
  public cancelCurrentGesture(): void {
    if (!this._isTracking && !this._isDragging) return
    this._cleanup()
    this._isDragging = false
  }
}

