/**
 * InteractionGate（交互门禁）
 *
 * 中文说明：
 * - 这是 MindMap 的交互基础设施，统一处理"事件是否应该触发选择/拖拽/缩放/上下文菜单"等行为
 * - 避免 node 内部 UI（按钮、链接、证据组件）误触发选择或拖拽
 * - 所有交互入口统一调用 Gate API，而不是各自判断 className/contentEditable
 *
 * 设计原则：
 * 1. 高内聚：所有交互过滤规则收敛在此模块
 * 2. 低耦合：feature/UI 只需添加 data 标记，无需修改交互逻辑
 * 3. 可观测：提供调试日志便于排查交互冲突
 */

// ============================================================================
// Data Attributes 标记规范
// ============================================================================

/**
 * 交互标记的 data attribute 名称
 *
 * 中文说明：
 * - 这些是 MindMap 内部约定的标记，用于控制交互行为
 * - feature/UI 只需在元素上添加对应标记，Gate 会自动识别并过滤
 */
export const InteractionMarkers = {
  /**
   * 标记为"交互元素"（按钮/链接/输入框等）
   * - 带此标记的元素点击不会触发节点选择
   * - 带此标记的元素拖拽不会触发节点拖拽
   */
  INTERACTIVE: 'data-mm-interactive',

  /**
   * 忽略选择：带此标记的元素不会触发 selection 引擎
   */
  IGNORE_SELECTION: 'data-mm-ignore-selection',

  /**
   * 忽略拖拽：带此标记的元素不会触发节点拖拽
   */
  IGNORE_DRAG: 'data-mm-ignore-drag',

  /**
   * 忽略画布移动：带此标记的元素不会触发画布 pan
   */
  IGNORE_PAN: 'data-mm-ignore-pan',
} as const

/**
 * 交互标记的值类型
 */
export type InteractionMarker = (typeof InteractionMarkers)[keyof typeof InteractionMarkers]

// ============================================================================
// 内置过滤规则（不需要 data 标记的元素）
// ============================================================================

/**
 * 内置的"交互元素"选择器
 *
 * 中文说明：
 * - 这些元素天然属于"交互元素"，无需手动添加 data 标记
 * - 例如：可编辑元素、链接标签编辑器、圆形控制点等
 */
const BUILTIN_INTERACTIVE_SELECTORS = [
  // 可编辑元素（contentEditable）
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  // 输入元素
  'input',
  'textarea',
  'select',
  'button',
  // MindMap 内部控制元素
  '.circle',              // 连线控制点
  '.svg-label-editor',    // SVG 标签编辑器
  'mm-expander',          // 折叠/展开按钮
] as const

/**
 * 内置的"忽略选择"选择器
 */
const BUILTIN_IGNORE_SELECTION_SELECTORS = [
  '.context-menu',        // 右键菜单
  '.svg-label-editor',    // SVG 标签编辑器
  '.circle',              // 连线控制点
] as const

/**
 * 内置的"忽略拖拽"选择器
 */
const BUILTIN_IGNORE_DRAG_SELECTORS = [
  '.context-menu',        // 右键菜单
  '.svg-label-editor',    // SVG 标签编辑器
  '.circle',              // 连线控制点
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  'input',
  'textarea',
] as const

// ============================================================================
// 辅助函数
// ============================================================================

/**
 * 检查元素或其祖先是否匹配指定的 data 标记
 *
 * @param element 目标元素
 * @param marker data attribute 名称
 * @param boundary 查找边界（默认到 document.body）
 */
function hasMarkerInAncestors(
  element: Element | null,
  marker: InteractionMarker,
  boundary?: Element | null
): boolean {
  if (!element) return false

  let current: Element | null = element
  const boundaryEl = boundary ?? document.body

  while (current && current !== boundaryEl) {
    if (current.hasAttribute(marker)) {
      return true
    }
    current = current.parentElement
  }

  return false
}

/**
 * 检查元素或其祖先是否匹配任一选择器
 *
 * @param element 目标元素
 * @param selectors 选择器列表
 * @param boundary 查找边界
 */
function matchesAnySelector(
  element: Element | null,
  selectors: readonly string[],
  boundary?: Element | null
): boolean {
  if (!element) return false

  let current: Element | null = element
  const boundaryEl = boundary ?? document.body

  while (current && current !== boundaryEl) {
    for (const selector of selectors) {
      if (current.matches(selector)) {
        return true
      }
    }
    current = current.parentElement
  }

  return false
}

// ============================================================================
// Gate API
// ============================================================================

/**
 * Gate 配置选项
 */
export interface InteractionGateOptions {
  /** 查找边界（默认为 mindmap container） */
  boundary?: Element | null
  /** 是否输出调试日志 */
  debug?: boolean
}

/**
 * Gate 上下文（传递给判断函数的信息）
 */
export interface GateContext {
  /** 事件目标元素 */
  target: Element
  /** 原始事件 */
  event: MouseEvent | TouchEvent | PointerEvent | DragEvent
  /** 查找边界 */
  boundary?: Element | null
}

/**
 * Wheel 事件上下文
 *
 * 中文说明：
 * - wheel 不属于 MouseEvent/PointerEvent，单独定义类型避免扩大 GateContext 的 event 联合导致误用
 */
export interface WheelGateContext {
  /** 事件目标元素 */
  target: Element
  /** 原始事件 */
  event: WheelEvent
  /** 查找边界 */
  boundary?: Element | null
}

/**
 * 判断是否应该忽略选择
 *
 * 中文说明：
 * - 返回 true 表示"应该忽略"，selection 引擎不应处理此事件
 * - 返回 false 表示"正常处理"
 *
 * 忽略条件（满足任一即忽略）：
 * 1. 右键点击（用于上下文菜单，不触发选择）
 * 2. 元素或祖先带有 data-mm-interactive 标记
 * 3. 元素或祖先带有 data-mm-ignore-selection 标记
 * 4. 元素或祖先匹配内置的"交互元素"选择器
 * 5. 元素或祖先匹配内置的"忽略选择"选择器
 */
export function shouldIgnoreSelection(ctx: GateContext, options: InteractionGateOptions = {}): boolean {
  const { target, event, boundary } = ctx
  const { debug = false } = options
  const boundaryEl = boundary ?? options.boundary ?? null

  // 1. 右键点击
  if ('button' in event && event.button === 2) {
    if (debug) console.log('[InteractionGate] Ignore selection: right-click')
    return true
  }

  // 2. data-mm-interactive 标记
  if (hasMarkerInAncestors(target, InteractionMarkers.INTERACTIVE, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore selection: data-mm-interactive')
    return true
  }

  // 3. data-mm-ignore-selection 标记
  if (hasMarkerInAncestors(target, InteractionMarkers.IGNORE_SELECTION, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore selection: data-mm-ignore-selection')
    return true
  }

  // 4. 内置交互元素
  if (matchesAnySelector(target, BUILTIN_INTERACTIVE_SELECTORS, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore selection: builtin interactive')
    return true
  }

  // 5. 内置忽略选择
  if (matchesAnySelector(target, BUILTIN_IGNORE_SELECTION_SELECTORS, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore selection: builtin ignore-selection')
    return true
  }

  return false
}

/**
 * 判断是否应该忽略拖拽
 *
 * 中文说明：
 * - 返回 true 表示"应该忽略"，不触发节点拖拽
 * - 返回 false 表示"正常处理"
 *
 * 忽略条件（满足任一即忽略）：
 * 1. 元素或祖先带有 data-mm-interactive 标记
 * 2. 元素或祖先带有 data-mm-ignore-drag 标记
 * 3. 元素或祖先匹配内置的"忽略拖拽"选择器
 */
export function shouldIgnoreDrag(ctx: GateContext, options: InteractionGateOptions = {}): boolean {
  const { target, boundary } = ctx
  const { debug = false } = options
  const boundaryEl = boundary ?? options.boundary ?? null

  // 中文说明（根因修复）：
  // - 在原生 HTML5 drag&drop 中，dragstart 的 event.target 往往是 draggable 元素本身（例如 mm-topic），
  //   而不是用户实际按下的子元素（例如 addon 内的文本/按钮）。
  // - 这会导致仅用“从 target 向上找祖先”的策略漏判：用户在 addon 内拖拽选中文本，却触发节点拖拽。
  // - 因此这里优先使用 composedPath()（若存在）在事件路径中查找标记/选择器，确保“真实起点”被识别。
  const evt = ctx.event as unknown as Event
  const path = typeof evt.composedPath === 'function' ? evt.composedPath() : []
  const effectiveBoundary = boundaryEl ?? document.body

  if (path.length > 0) {
    for (const p of path) {
      if (!(p instanceof Element)) continue
      if (p === effectiveBoundary) break
      if (p.hasAttribute(InteractionMarkers.INTERACTIVE)) {
        if (debug) console.log('[InteractionGate] Ignore drag: data-mm-interactive (path)')
        return true
      }
      if (p.hasAttribute(InteractionMarkers.IGNORE_DRAG)) {
        if (debug) console.log('[InteractionGate] Ignore drag: data-mm-ignore-drag (path)')
        return true
      }
      for (const selector of BUILTIN_IGNORE_DRAG_SELECTORS) {
        if (p.matches(selector)) {
          if (debug) console.log('[InteractionGate] Ignore drag: builtin ignore-drag (path)')
          return true
        }
      }
    }
  }

  // 1. data-mm-interactive 标记（fallback：无 composedPath）
  if (hasMarkerInAncestors(target, InteractionMarkers.INTERACTIVE, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore drag: data-mm-interactive')
    return true
  }

  // 2. data-mm-ignore-drag 标记（fallback）
  if (hasMarkerInAncestors(target, InteractionMarkers.IGNORE_DRAG, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore drag: data-mm-ignore-drag')
    return true
  }

  // 3. 内置忽略拖拽（fallback）
  if (matchesAnySelector(target, BUILTIN_IGNORE_DRAG_SELECTORS, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore drag: builtin ignore-drag')
    return true
  }

  return false
}

/**
 * 判断是否应该忽略画布移动（pan）
 *
 * 中文说明：
 * - 返回 true 表示"应该忽略"，不触发画布移动
 * - 返回 false 表示"正常处理"
 *
 * 忽略条件（满足任一即忽略）：
 * 1. 元素或祖先带有 data-mm-interactive 标记
 * 2. 元素或祖先带有 data-mm-ignore-pan 标记
 * 3. 元素是可编辑元素（contentEditable/input/textarea）
 */
export function shouldIgnorePan(ctx: GateContext, options: InteractionGateOptions = {}): boolean {
  const { target, boundary } = ctx
  const { debug = false } = options
  const boundaryEl = boundary ?? options.boundary ?? null

  // 1. data-mm-interactive 标记
  if (hasMarkerInAncestors(target, InteractionMarkers.INTERACTIVE, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore pan: data-mm-interactive')
    return true
  }

  // 2. data-mm-ignore-pan 标记
  if (hasMarkerInAncestors(target, InteractionMarkers.IGNORE_PAN, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore pan: data-mm-ignore-pan')
    return true
  }

  // 3. 可编辑元素
  const editableSelectors = [
    '[contenteditable="true"]',
    '[contenteditable="plaintext-only"]',
    'input',
    'textarea',
  ] as const
  if (matchesAnySelector(target, editableSelectors, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore pan: editable element')
    return true
  }

  return false
}

/**
 * 判断是否应该忽略滚轮（wheel）
 *
 * 中文说明（根因修复）：
 * - MindMap 的 wheel handler 默认会 preventDefault + move/zoom，导致：
 *   1) addon 内部的滚动容器无法滚动
 *   2) 用户在 addon 上滚动时反而触发画布移动/缩放（体验不合理）
 * - 这里把 wheel 的过滤规则收敛到 Gate：
 *   - 若事件来自交互区域（data-mm-interactive / button / input 等），则应忽略 MindMap wheel handler，交给浏览器原生滚动
 */
export function shouldIgnoreWheel(ctx: WheelGateContext, options: InteractionGateOptions = {}): boolean {
  const { target, boundary } = ctx
  const { debug = false } = options
  const boundaryEl = boundary ?? options.boundary ?? null

  // 1. data-mm-interactive 标记
  if (hasMarkerInAncestors(target, InteractionMarkers.INTERACTIVE, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore wheel: data-mm-interactive')
    return true
  }

  // 2. data-mm-ignore-pan 标记（滚轮通常等价于平移/缩放入口）
  if (hasMarkerInAncestors(target, InteractionMarkers.IGNORE_PAN, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore wheel: data-mm-ignore-pan')
    return true
  }

  // 3. 内置交互元素：输入框/按钮等，默认应把滚轮交给浏览器（例如 textarea 滚动）
  if (matchesAnySelector(target, BUILTIN_INTERACTIVE_SELECTORS, boundaryEl)) {
    if (debug) console.log('[InteractionGate] Ignore wheel: builtin interactive')
    return true
  }

  return false
}

/**
 * 判断是否应该忽略上下文菜单
 *
 * 中文说明：
 * - 返回 true 表示"应该忽略"，不弹出上下文菜单
 * - 返回 false 表示"正常处理"
 *
 * 当前实现：上下文菜单不做特殊过滤，始终允许
 * 后续可根据需要扩展
 */
export function shouldIgnoreContextMenu(ctx: GateContext, options: InteractionGateOptions = {}): boolean {
  // 当前不做特殊过滤
  return false
}

/**
 * 判断目标元素是否是"交互元素"
 *
 * 中文说明：
 * - 交互元素指按钮、链接、输入框等需要响应点击的元素
 * - 点击交互元素不应触发节点选择/拖拽等行为
 */
export function isInteractiveElement(ctx: GateContext, options: InteractionGateOptions = {}): boolean {
  const { target, boundary } = ctx
  const boundaryEl = boundary ?? options.boundary ?? null

  // 1. data-mm-interactive 标记
  if (hasMarkerInAncestors(target, InteractionMarkers.INTERACTIVE, boundaryEl)) {
    return true
  }

  // 2. 内置交互元素
  if (matchesAnySelector(target, BUILTIN_INTERACTIVE_SELECTORS, boundaryEl)) {
    return true
  }

  return false
}

// ============================================================================
// 便捷工具函数
// ============================================================================

/**
 * 创建带有交互标记的 props 对象（用于 Vue 组件）
 *
 * 中文说明：
 * - 在 Vue 模板中使用 v-bind="interactiveProps()" 即可标记为交互元素
 */
export function interactiveProps(): Record<string, string> {
  return { [InteractionMarkers.INTERACTIVE]: 'true' }
}

/**
 * 创建忽略选择标记的 props 对象
 */
export function ignoreSelectionProps(): Record<string, string> {
  return { [InteractionMarkers.IGNORE_SELECTION]: 'true' }
}

/**
 * 创建忽略拖拽标记的 props 对象
 */
export function ignoreDragProps(): Record<string, string> {
  return { [InteractionMarkers.IGNORE_DRAG]: 'true' }
}

/**
 * 创建忽略画布移动标记的 props 对象
 */
export function ignorePanProps(): Record<string, string> {
  return { [InteractionMarkers.IGNORE_PAN]: 'true' }
}
