import { EventTarget } from './EventEmitter'
import ScrollHandler from './ScrollHandler'
import SelectionRenderer from './SelectionRenderer'
import SelectionStoreManager from './SelectionStoreManager'
import { InputObserver } from './InputObserver'
import { SelectionStrategy } from './SelectionStrategy'
import type { AreaLocation, SelectionEvents, SelectionOptions, SelectionStore } from './types'
import type { PartialSelectionOptions } from './types'
import { selectionEvents, selectionGeometry, selectionHelpers } from '../utils'
import type { Frames, SelectAllSelectors } from '../utils'

// 重新导出所有类型定义
export * from './types'

// 工具函数简写，用于代码压缩和可读性
const { on, off, simplifyEvent } = selectionEvents
const { domRect } = selectionGeometry
const { selectAll, css, frames } = selectionHelpers

/**
 * 创建初始化的选择 Store 对象
 * @param stored - 已存储的选中元素列表
 * @returns 新的选择 Store，包含 stored/selected/touched/changed 四个字段
 */
const makeSelectionStore = (stored: Element[] = []): SelectionStore => ({
  stored,  // 持久化的选中列表（手动操作后保留）
  selected: [],  // 当前拖拽过程中选中的元素
  touched: [],  // 被拖拽框接触过的元素
  changed: { added: [], removed: [] },  // 本次操作的增删变化
})

/**
 * SelectionArea - 框选引擎（协调器）
 * 
 * 职责：组织各子模块（InputObserver、SelectionStrategy、SelectionRenderer、SelectionStoreManager）
 * 的事件流，管理选中状态的生命周期。
 * 
 * 核心流程：
 * 1. InputObserver 捕获 DOM 事件，判定点击或拖拽
 * 2. SelectionStrategy 处理选择逻辑（Shift/Ctrl 等按键）
 * 3. SelectionStoreManager 更新 Store
 * 4. SelectionRenderer 重绘选框 DOM
 * 5. 外部监听器触发业务逻辑
 */
export default class SelectionArea extends EventTarget<SelectionEvents> {

  // ========== 配置与状态 ==========
  /** 初始化配置选项（行为、特性等） */
  private readonly _options: SelectionOptions

  /** 选择 Store，记录选中状态、变化等 */
  private _selection: SelectionStore = makeSelectionStore()

  /** 调试模式标志位 */
  private readonly _debugEnabled: boolean

  // ========== 拖拽过程中的临时状态 ==========
  /** 当前拖拽的目标元素（通常是容器） */
  private _targetElement?: Element
  
  /** 目标元素的边界矩形（缓存，用于计算是否超出边界） */
  private _targetRect?: DOMRect
  
  /** 当前可选元素列表（根据 selectables 选择器动态更新） */
  private _selectables: Element[] = []
  
  /** 最后选中的元素（用于 Shift 范围选择的基准） */
  private _latestElement?: Element

  // ========== 选框区域坐标 ==========
  /** 选框的四个角坐标 { x1, y1, x2, y2 } */
  private _areaLocation: AreaLocation = { y1: 0, x2: 0, y2: 0, x1: 0 }
  
  /** 选框的最终计算矩形（经过滚动偏移调整后的实际坐标） */
  private _areaRect = domRect()

  // ========== 交互状态标志 ==========
  /** 标记当前是否为单击（未超过拖拽阈值） */
  private _singleClick = true

  /**
   * 是否禁止本次手势进入“拖拽框选”
   *
   * 中文说明（根因修复）：
   * - 用户从某些宿主元素上开始拖动时，语义应该优先属于“宿主拖拽/移动”，而不是出现框选框。
   * - Selection 引擎同时承担 tap 与 drag 两种能力：这里只禁止 drag，不影响 tap。
   * - 必须以“按下起点”为准（move 阶段 event.target 会漂移），因此在 _onDown 记录。
   * - 具体“哪些元素应抑制 drag selection”由 Adapter 注入（SelectionEngine 不应了解宿主 DOM）。
   */
  private _suppressDragSelection = false

  /**
   * 标记选框是否已进入“拖拽进行中”阶段（超过阈值并进入 start）。
   * 用于让 cancel 在非拖拽场景下保持幂等，避免无意义的 stop/DOM 操作。
   */
  private _isAreaDragging = false

  /**
   * 当前是否处于“框选拖拽中”
   *
   * 中文说明：
   * - 这是给宿主（如自动刷新门禁）使用的**只读观测口径**；
   * - 禁止外部通过类型断言读取私有字段 `_isAreaDragging`（会被 TS 判定为越权且不稳定）；
   * - 该 getter 只暴露 boolean，不暴露内部细节，保持高内聚低耦合。
   */
  public get isAreaDragging(): boolean {
    return this._isAreaDragging
  }
  
  /** RequestAnimationFrame 帧管理对象，用于限流拖拽过程中的频繁更新 */
  private _frame: Frames

  // ========== 子模块实例 ==========
  /** 自动滚动处理（在拖拽时检测边界滚动） */
  private readonly _scroll: ScrollHandler
  
  /** 选框 DOM 创建与重绘 */
  private readonly _renderer: SelectionRenderer
  
  /** 选中状态管理 */
  private readonly _storeManager: SelectionStoreManager
  
  /** 输入事件监听与手势识别 */
  private readonly _input: InputObserver

  /**
   * 构造函数：初始化选择引擎
   * @param opt - 初始化选项（选择器、容器、行为配置等）
   */
  constructor(opt: PartialSelectionOptions) {
    super()

    const { filterTarget, suppressDragSelectionFromDownTarget, ...restOpt } = opt ?? {}

    // 合并所有配置选项，建立默认值
    this._options = {
      selectionAreaClass: 'selection-area',  // 选框 DOM 的 CSS class
      selectionContainerClass: undefined,  // 选框容器的 CSS class（可选）
      selectables: [],  // 可选择元素的选择器数组
      document: window.document,  // 要操作的 Document 对象
      startAreas: ['html'],  // 允许开始拖拽的区域（选择器或元素）
      boundaries: ['html'],  // 拖拽边界限制区域
      container: 'body',  // 选框挂载的容器
      mindMapInstance: undefined,  // 引用 MindMap 实例（可选）
      debug: false,  // 调试模式
      filterTarget: typeof filterTarget === 'function' ? (filterTarget as (target: HTMLElement, evt: MouseEvent | TouchEvent) => boolean) : undefined,
      suppressDragSelectionFromDownTarget:
        typeof suppressDragSelectionFromDownTarget === 'function'
          ? suppressDragSelectionFromDownTarget
          : undefined,
      ...restOpt,

      // 行为配置
      behaviour: {
        overlap: 'invert',  // 交集处理方式
        intersect: 'touch',  // 交集判定方式
        triggers: [0],  // 触发拖拽的鼠标按键（0=左键, 2=右键）
        ...opt.behaviour,
        // 拖拽阈值：超过此距离才认为是拖拽而非点击
        startThreshold: opt.behaviour?.startThreshold
          ? typeof opt.behaviour.startThreshold === 'number'
            ? opt.behaviour.startThreshold
            : { x: 10, y: 10, ...opt.behaviour.startThreshold }
          : { x: 10, y: 10 },
        // 自动滚动配置
        scrolling: {
          speedDivider: 10,  // 滚动速度分母（越小越快）
          manualSpeed: 750,  // 手动滚动的速度
          ...opt.behaviour?.scrolling,
          startScrollMargins: {
            x: 0,
            y: 0,
            ...opt.behaviour?.scrolling?.startScrollMargins,
          },
        },
      },

      // 功能特性配置
      features: {
        range: true,  // 支持 Shift 范围选择
        touch: true,  // 支持触摸设备
        deselectOnBlur: false,  // 失焦时是否取消选择
        ...opt.features,
        singleTap: {
          allow: true,  // 允许单击选择
          intersect: 'native',  // 单击的碰撞检测方式
          ...opt.features?.singleTap,
        },
      },
    }

    this._debugEnabled = Boolean(this._options.debug)

    // ========== 绑定所有方法以保持 this 上下文 ==========
    // 这些方法会被作为回调传给 InputObserver，需要保持正确的 this 指向
    this._onDown = this._onDown.bind(this)
    this._onDragStart = this._onDragStart.bind(this)
    this._onDragMove = this._onDragMove.bind(this)
    this._onDragStop = this._onDragStop.bind(this)
    this._onTap = this._onTap.bind(this)
    this._onScroll = this._onScroll.bind(this)

    // ========== 初始化各子模块 ==========
    this._scroll = new ScrollHandler(() => this._options)
    this._renderer = new SelectionRenderer(this._options)
    this._storeManager = new SelectionStoreManager({
      getOptions: () => this._options,
      getSelectionStore: () => this._selection,
      getSelectables: () => this._selectables,
      getLatestElement: () => this._latestElement,
      setLatestElement: el => {
        this._latestElement = el
      },
    })

    // 初始化输入观察器（处理 DOM 事件和手势识别）
    this._input = new InputObserver({
        startThreshold: this._options.behaviour.startThreshold,
        document: this._options.document,
        startAreas: this._options.startAreas,
        filterTarget: this._options.filterTarget
    })

    // ========== 连接事件流 ==========
    // InputObserver 发出的事件 → Engine 的处理方法
    this._input.on('down', this._onDown)  // 按下时记录坐标
    this._input.on('start', this._onDragStart)  // 拖拽开始
    this._input.on('move', this._onDragMove)  // 拖拽移动
    this._input.on('stop', this._onDragStop)  // 拖拽结束
    this._input.on('tap', this._onTap)  // 单击（点击而非拖拽）
    this._input.on('scroll', this._onScroll)  // 滚动

    // ========== 帧管理器：用于限流拖拽过程中的频繁更新 ==========
    // 每帧执行：重新计算选框、更新 Store、触发事件、重绘 DOM
    this._frame = frames((evt: MouseEvent | TouchEvent) => {
      this._recalculateSelectionAreaRect()  // 根据滚动重新计算选框坐标
      this._storeManager.updateElementSelection(this._areaRect)  // 检测碰撞，更新 Store
      this._emitEvent('move', evt)  // 触发 move 事件（外部监听）
      this._redrawSelectionArea()  // 重绘选框 DOM
    })

    // 启用输入监听
    this.enable()
  }

  /**
   * [事件处理] 按下时的回调
   * 记录起始坐标和目标元素
   */
  _onDown(evt: MouseEvent | TouchEvent) {
      const { x, y } = simplifyEvent(evt)
      // 初始化选框坐标为起点（四个角相同）
      this._areaLocation = { x1: x, y1: y, x2: x, y2: y }
      
      // 确定目标元素（选框范围限制容器）
      // 优先从 boundaries 中查找包含当前点击目标的元素
      // 这样可以确保选框范围是整个画布（mind.container），而不是被限制在子容器（如 .rhs）中
      const rawTarget = evt.target
      const target = rawTarget instanceof Element ? rawTarget : rawTarget instanceof Node ? rawTarget.parentElement : null

      /**
       * 中文说明（根因修复）：
       * - `SelectionEvents` 类型里定义了 `beforestart`，Adapter 侧也在监听它
       * - 但此前引擎从未触发该事件，导致宿主无法在“按下开始一次选择手势”时做必要清理
       *   典型表现：addon 内部的原生文本选区在点击画布其它位置后仍不取消
       * - 这里统一在 down 阶段触发 `beforestart`，覆盖 tap 与 drag 两条路径
       */
      if (this._emitEvent('beforestart', evt) === false) {
        // 中文说明：InputObserver 已在 down 时把 move/up 监听挂到了 document 上，必须显式取消
        this._input.cancelCurrentGesture()
        this._singleClick = true
        this._isAreaDragging = false
        return
      }

      // 记录：本次手势是否需要抑制 drag selection（由宿主注入规则决定）
      this._suppressDragSelection = Boolean(
        target && typeof this._options.suppressDragSelectionFromDownTarget === 'function'
          ? this._options.suppressDragSelectionFromDownTarget(target)
          : false
      )
      let boundaryElement: Element | undefined

      const boundaries = Array.isArray(this._options.boundaries)
        ? this._options.boundaries
        : [this._options.boundaries]

      for (const boundary of boundaries) {
        // boundary 可能是选择器字符串或 DOM 元素
        const els = typeof boundary === 'string' ? selectAll(boundary, this._options.document) : [boundary]
        for (const el of els) {
            if (target && el.contains(target)) {
                boundaryElement = el
                break
            }
        }
        if (boundaryElement) break
      }
      
      // 如果找到了 boundary，就作为目标元素；否则回退到 container；最后回退到 evt.target
      if (boundaryElement) {
          this._targetElement = boundaryElement
      } else {
          const containers = selectAll(this._options.container, this._options.document)
          const container = target ? containers.find(c => c.contains(target)) : undefined
          // target 可能为空（极端情况），此时回退到 container
          this._targetElement = container || target || containers[0]
      }
  }

  /**
   * [事件处理] 拖拽开始（已超过阈值）
   * 初始化选框 DOM、计算可选元素列表、设置滚动检测
   */
  _onDragStart(evt: MouseEvent | TouchEvent) {
    // 从宿主“抑制规则”命中的元素起点开始拖动：禁止进入框选拖拽，立即取消 selection 手势监听
    // 中文说明：这里不影响 tap（tap 已在 mouseup 前结束）；此分支只会发生在超过阈值的拖拽路径上。
    if (this._suppressDragSelection) {
      this._input.cancelCurrentGesture()
      this._singleClick = true
      this._isAreaDragging = false
      return
    }

    // 触发 beforedrag 事件，允许外部取消
    if (this._emitEvent('beforedrag', evt) === false) {
        return
    }

    // 中文说明（关键行为约束）：
    // - “从空白处开始框选”应当是 *替换选区* 的语义：开始框选时先清空旧选中
    // - 旧实现主要依赖 Adapter 在 beforestart 中调用 mind.clearSelection，但在某些链路/竞态下可能失效，
    //   导致框选结束后旧选中仍保留（表现为“框选不取消之前选中”）
    // - 因此在引擎层做一次兜底：当未按 Ctrl/Cmd 时，drag selection 开始即清空内部 Store，并发出 move/stop 让宿主同步 UI。
    const mouseEvt = evt as MouseEvent
    const shouldReplaceSelection =
      !('ctrlKey' in mouseEvt) || (!mouseEvt.ctrlKey && !mouseEvt.metaKey)
    if (shouldReplaceSelection) {
      this.clearSelection(true, false)
    }

    // 显示选框 DOM
    css(this._renderer.area, 'display', 'block')
    
    // 将选框挂载到指定容器
    const container = selectAll(this._options.container, this._options.document)[0]
    if (container) {
        this._renderer.mount(container)
    }
    
    // 解析可选元素列表
    this.resolveSelectables()
    // 标记为拖拽（而非单击）
    this._singleClick = false
    this._isAreaDragging = true
    
    // 获取目标元素的边界矩形
    if (this._targetElement) {
        this._targetRect = this._targetElement.getBoundingClientRect()
        
        // 检查目标元素是否可滚动
        // 只有当 overflow 为 auto/scroll 且内容确实溢出时，才认为是滚动容器
        // 这样避免了普通容器（如 mm-main.rhs）被误判为滚动容器，导致选框被限制在其中
        const style = window.getComputedStyle(this._targetElement)
        const overflowY = style.overflowY
        const overflowX = style.overflowX
        const isScrollable = (overflowY === 'auto' || overflowY === 'scroll' || overflowX === 'auto' || overflowX === 'scroll') &&
            (this._targetElement.scrollHeight > this._targetElement.clientHeight ||
            this._targetElement.scrollWidth > this._targetElement.clientWidth)

        this._scroll.scrollAvailable = isScrollable

        // 如果可滚动，只保留在目标元素内部的可选元素
        // 这样可以避免跨越滚动边界的误选
        if (this._scroll.scrollAvailable) {
             this._selectables = this._selectables.filter(s => this._targetElement!.contains(s))
        }
    }

    this._setupSelectionArea()
    // 触发 start 事件（外部监听）
    this._emitEvent('start', evt)
    
    // 立即触发第一次 move 事件以初始化选框
    this._onDragMove(evt)
  }

  /**
   * [事件处理] 拖拽移动
   * 更新选框坐标，触发帧更新（限流）
   */
  _onDragMove(evt: MouseEvent | TouchEvent) {
      const { x, y } = simplifyEvent(evt)
      // 更新选框右下角坐标
      this._areaLocation.x2 = x
      this._areaLocation.y2 = y
      // 通过帧管理器限流，避免频繁更新 DOM
      this._frame.next(evt)
  }

  /**
   * [事件处理] 拖拽结束
   * 清理选框 DOM、停止滚动、恢复单击模式
   */
  _onDragStop(evt: MouseEvent | TouchEvent | null) {
      if (!this._isAreaDragging) {
        // 没有进入过真正的选框拖拽，不做任何终止逻辑
        return
      }
      // 保持选中状态（将 selected 转移到 stored）
      this._storeManager.keepSelection()
      // 触发 stop 事件（外部监听）
      this._emitEvent('stop', evt)
      
      // 清理自动滚动
      this._scroll.resetScrollSpeed()
      // 从 DOM 中移除选框
      this._renderer.remove()
      // 取消帧管理器
      this._frame?.cancel()
      // 隐藏选框
      this._renderer.hide()
      // 恢复单击模式标记
      this._singleClick = true
      this._isAreaDragging = false
  }

  /**
   * [事件处理] 单击（未触发拖拽）
   * 根据按键状态（Shift/Ctrl）决定选中/反选/范围选择
   */
  _onTap(evt: MouseEvent | TouchEvent) {
    // 如果禁用了单击选择，直接返回
    if (!this._options.features.singleTap.allow) {
        return
    }

    // 重新解析可选元素列表
    this.resolveSelectables()
    
    const { intersect } = this._options.features.singleTap
    let target: Element | undefined

    // 根据碰撞检测方式找到目标元素
    if (intersect === 'native') {
        // 使用原生 DOM 事件的 target
        target = evt.target as Element
    } else if (intersect === 'touch') {
        // 通过坐标碰撞检测找到目标元素
        const { x, y } = simplifyEvent(evt)
        target = this._selectables.find(v => {
            const { right, left, top, bottom } = v.getBoundingClientRect()
            return x < right && x > left && y < bottom && y > top
        })
    }
    
    // 使用 Strategy 向上遍历 DOM 树，找到最近的可选元素
    if (target) {
        target = SelectionStrategy.getSelectableFromTarget(target, this._selectables)
    }

    // 没有找到有效的目标，清空选择
    if (!target) {
        this.clearSelection()
        return
    }

    // 调用选择策略，根据按键状态（Shift/Ctrl/Cmd）决定选择行为
    const result = SelectionStrategy.resolveClick(
        target, 
        evt, 
        {
            selection: this._selection.stored,
            selectables: this._selectables,
            latestElement: this._latestElement
        }, 
        { range: this._options.features.range }
    )

    // 执行选择变化
    if (result.toSelect.length) this.select(result.toSelect)
    if (result.toDeselect.length) this.deselect(result.toDeselect)
    if (result.newLatest) this._latestElement = result.newLatest

    // 触发事件通知外部
    this._emitEvent('start', evt)
    this._emitEvent('stop', evt)
  }

  /**
   * [事件处理] 滚动事件
   * 在拖拽过程中，容器滚动时需要重新计算选框坐标并重绘
   */
  _onScroll(evt: Event) {
      // 根据滚动偏移重新计算选框坐标
      this._recalculateSelectionAreaRect()
      // 重绘选框 DOM
      this._renderer.redrawSelectionArea(this._areaRect, this._targetRect)
  }

  /**
   * [内部方法] 设置选框初始状态
   * 计算目标元素的边界矩形，将选框初始化到该区域
   */
  _setupSelectionArea(): void {
    const { _targetElement } = this
    if (_targetElement) {
        this._targetRect = _targetElement.getBoundingClientRect()
        this._renderer.setupSelectionArea(this._targetRect, _targetElement)
    }
  }

  /**
   * [内部方法] 重新计算选框矩形（考虑滚动偏移）
   * 当容器滚动时需要调用此方法以获得实际的选框坐标
   */
  _recalculateSelectionAreaRect(): void {
    const _targetRect = this._targetRect as DOMRect
    // 通过 ScrollHandler 调整坐标，考虑滚动偏移
    this._areaRect = this._scroll.recalculateSelectionAreaRect(this._areaLocation, _targetRect)
  }

  /**
   * [内部方法] 重绘选框 DOM
   */
  _redrawSelectionArea(): void {
    this._renderer.redrawSelectionArea(this._areaRect, this._targetRect)
  }

  /**
   * [内部方法] 触发事件（发送给外部监听器）
   * @param name - 事件名称
   * @param evt - 源 DOM 事件（可能为 null）
   * @returns 事件是否继续传播
   */
  _emitEvent(name: keyof SelectionEvents, evt: MouseEvent | TouchEvent | null): unknown {
    return this.emit(name, {
      event: evt,
      store: this._selection,
      selection: this,
    })
  }

  /**
   * 手动触发选择开始（用于程序化触发）
   * @param evt - 模拟的 DOM 事件
   * @param silent - 是否不触发 beforestart 事件
   */
  trigger(evt: MouseEvent | TouchEvent, silent = true): void {
    this._onDown(evt)
    this._onTap(evt)
  }

  /**
   * 解析并缓存所有可选元素
   * 根据 options.selectables 选择器查询 DOM，构建可选元素列表
   */
  resolveSelectables(): void {
    this._selectables = selectAll(this._options.selectables, this._options.document)
  }

  /**
   * 清空当前选择
   * @param includeStored - 是否同时清空持久化存储（true=完全清空，false=仅清空临时选择）
   * @param quiet - 是否不触发事件
   */
  clearSelection(includeStored = true, quiet = false): void {
    const { selected, stored } = this._selection

    // 中文说明（关键修复）：
    // - 旧实现会先 emit(move/stop)，再重置 _selection；
    //   Adapter 的 stop 回调若读取 store.stored，会读到“旧 stored”，从而把业务层选中状态又写回去。
    // - 新实现先构造“清空后的 store”，再把 removed 填进去，最后 emit；
    //   这样 stop 事件中看到的 store.stored 一定是清空后的结果。
    const removed = [...selected, ...(includeStored ? stored : [])]
    const nextStored = includeStored ? [] : stored
    this._selection = makeSelectionStore(nextStored)
    this._selection.changed.added = []
    this._selection.changed.removed = removed

    if (!quiet) {
      this._emitEvent('move', null)
      this._emitEvent('stop', null)
    }
  }

  /**
   * 获取当前选中的元素列表
   * @returns 已选中元素数组
   */
  getSelection(): Element[] {
    return this._selection.stored
  }

  /**
   * 获取选框 DOM 元素
   * @returns 选框的 HTMLElement
   */
  getSelectionArea(): HTMLElement {
    return this._renderer.area
  }

  /**
   * 获取当前的可选元素列表
   * @returns 可选元素数组
   */
  getSelectables(): Element[] {
    return this._selectables
  }

  /**
   * 手动设置选框位置
   * @param location - 新的选框坐标（部分更新）
   */
  setAreaLocation(location: Partial<AreaLocation>) {
    Object.assign(this._areaLocation, location)
    this._redrawSelectionArea()
  }

  /**
   * 获取当前选框的坐标
   * @returns 选框四个角的坐标 { x1, y1, x2, y2 }
   */
  getAreaLocation(): AreaLocation {
    return this._areaLocation
  }

  /**
   * 取消当前的拖拽操作
   * @param keepEvent - 是否触发 stop 事件
   */
  cancel(keepEvent = false): void {
    // 先终止输入监听，避免在 cancel 后仍继续收到 move（尤其是 native drag 吃掉 mouseup 的场景）
    this._input.cancelCurrentGesture()
    if (!this._isAreaDragging) return

    if (keepEvent) {
      this._onDragStop(null)
      return
    }

    // 不触发 stop 事件：用于外部强制中止（如节点拖拽开始时）
    // 但仍需完整清理渲染与内部状态。
    this._scroll.resetScrollSpeed()
    this._renderer.remove()
    this._frame?.cancel()
    this._renderer.hide()
    this._singleClick = true
    this._isAreaDragging = false
  }

  /**
   * 销毁选择引擎，清理所有资源
   * 移除 DOM、解绑事件监听器、销毁子模块
   */
  destroy(): void {
    this.cancel()
    this.disable()
    this._renderer.remove()
    super.unbindAllListeners()
  }

  /**
   * 启用选择引擎（开启 DOM 事件监听）
   */
  enable(): void {
      this._input.enable()
  }

  /**
   * 禁用选择引擎（关闭 DOM 事件监听）
   */
  disable(): void {
      this._input.disable()
  }

  /**
   * 主动选中一个或多个元素
   * @param query - 选择器或元素数组
   * @param quiet - 是否不触发事件
   * @returns 成功选中的元素数组
   */
  select(query: SelectAllSelectors, quiet = false): Element[] {
    return this._storeManager.select(query, this._options.document, quiet, (name, evt) => this._emitEvent(name, evt))
  }

  /**
   * 主动取消选中一个或多个元素
   * @param query - 选择器或元素数组
   * @param quiet - 是否不触发事件
   */
  deselect(query: SelectAllSelectors, quiet = false) {
    this._storeManager.deselect(query, this._options.document, quiet, (name, evt) => this._emitEvent(name, evt))
  }

  /**
   * [调试方法] 输出调试信息（目前禁用）
   */
  private _debug(message: string, payload?: Record<string, unknown>) {
    // 调试输出已禁用
  }
}
