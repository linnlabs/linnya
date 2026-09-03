/**
 * renderVirtualizationConstants.ts
 *
 * RenderVirtualization 模块内共享常量。
 */

// 中文说明：默认高度宁可略高，也不要在万行文档中明显低估总滚动高度。
// 真实高度会在块 hydrated 后写入 BlockHeightCache，后续 placeholder 复用真实测量值。
export const DEFAULT_PLACEHOLDER_ROOT_BLOCK_HEIGHT = 120

// 中文说明：`.root-block-outer` 默认有 5px 块间距。
// 这个间距不包含在 getBoundingClientRect().height 中，但会参与真实滚动高度；
// 虚拟滚动窗口计算必须把它纳入 layout span，否则越往下滚累计误差越大。
export const DEFAULT_ROOT_BLOCK_LAYOUT_MARGIN_AFTER = 5

// 中文说明：阶段 1 先把入屏 hydrated 数量压下来。默认只预取约 0.75 屏；
// 小屏幕仍保留 900px 下限，避免滚动稍快就露出 placeholder。
export const DEFAULT_RENDER_WINDOW_OVERSCAN_VIEWPORTS = 0.75
export const MIN_RENDER_WINDOW_OVERSCAN_PX = 900

// 中文说明：当前瓶颈已经从“全量 DOM”转移到“单轮创建 Vue NodeView”。
// 1500 块压测中，同一轮创建 100+ 个 Vue BlockView 会让 Vue/Tiptap 的后续 flush 队列卡住事件循环；
// 因此窗口下限必须按“可调度的一批”控制，而不是按视觉预取的保守大窗口控制。
export const MIN_RENDER_WINDOW_BLOCK_COUNT = 32
export const MAX_RENDER_WINDOW_BLOCK_COUNT = 96
export const RENDER_WINDOW_BLOCK_COUNT_HEADROOM = 1.25

// 中文说明：滚动条拖拽 / 程序跳转超过约 1.5 屏时立即同步纠偏；
// 累计普通滚动超过约 3 屏时做一次 DOM 纠偏，避免高度缓存漂移堆积。
export const MIN_IMMEDIATE_SCROLL_JUMP_PX = 1200
export const IMMEDIATE_SCROLL_REFRESH_THROTTLE_MS = 80
export const MIN_DOM_CORRECTION_SCROLL_DISTANCE_PX = 2400
export const DOM_CORRECTION_REFRESH_THROTTLE_MS = 160
// 中文说明：直接拖动原生滚动条时，浏览器可能只连续发普通 scroll 事件；
// 最后一帧如果没有达到 jump/correction 阈值，窗口会停在高度缓存推导结果。
// 因此滚动停止后补一次 correction 刷新，让中段/底部跳转用真实 DOM 视口纠偏。
// 这里不能太短：原生滚动条拖拽时 scroll 事件可能有短暂停顿，过早纠偏会表现为“拖着拖着跳一下”。
export const SCROLL_SETTLE_CORRECTION_MS = 220

// 中文说明：未知块高度会用已测量块的平均值自适应，减少中段/底部纠偏时的跳动。
// 默认未知高度仍是 120px；一旦首屏样本可用，自适应下限必须允许短文本块回落到真实高度附近，
// 否则 5000+ 纯文本大文档会持续高估总高度，滚动条表现为回弹和不跟手。
export const ADAPTIVE_BLOCK_HEIGHT_MIN_SAMPLE_COUNT = 8
export const ADAPTIVE_BLOCK_HEIGHT_MIN_ELEMENT_HEIGHT = 32
export const ADAPTIVE_BLOCK_HEIGHT_MAX_ELEMENT_HEIGHT = 480

// 中文说明：DOM sample 只在远距离跳转 / 漂移纠偏时使用，不进入普通滚动热路径。
export const DOM_WINDOW_SAMPLE_ROW_STEP_PX = 48

// 中文说明：scroll handshake 等待的是 NodeView 生命周期事件，不是逐帧轮询。
// 低性能设备或 Markdown 重活阻塞主线程时 120ms 太紧，这里给到 600ms，同时仍保留调用方覆盖能力。
export const DEFAULT_SCROLL_HANDSHAKE_TIMEOUT_MS = 600
export const DEFAULT_SCROLL_HANDSHAKE_TEMPORARY_PIN_MS = 220

export function resolveRenderWindowOverscanPx(params: {
  scrollRoot: HTMLElement | null
  configuredOverscanPx?: number
}): number {
  if (typeof params.configuredOverscanPx === 'number') {
    return Math.max(0, params.configuredOverscanPx)
  }
  const viewportHeight = params.scrollRoot?.clientHeight ?? 0
  return Math.max(
    MIN_RENDER_WINDOW_OVERSCAN_PX,
    viewportHeight * DEFAULT_RENDER_WINDOW_OVERSCAN_VIEWPORTS
  )
}

export function resolveRenderWindowBlockCount(params: {
  viewportHeight: number
  overscanPx: number
  totalEstimatedHeight: number
  blockCount: number
  configuredMaxWindowBlockCount?: number
}): number {
  if (typeof params.configuredMaxWindowBlockCount === 'number') {
    return Math.max(1, params.configuredMaxWindowBlockCount)
  }

  const averageHeight = params.blockCount > 0
    ? Math.max(1, params.totalEstimatedHeight / params.blockCount)
    : DEFAULT_PLACEHOLDER_ROOT_BLOCK_HEIGHT
  const visibleSpan = Math.max(1, params.viewportHeight + params.overscanPx * 2)
  const dynamicCount = Math.ceil(
    (visibleSpan / averageHeight) * RENDER_WINDOW_BLOCK_COUNT_HEADROOM
  )

  return Math.min(
    MAX_RENDER_WINDOW_BLOCK_COUNT,
    Math.max(MIN_RENDER_WINDOW_BLOCK_COUNT, dynamicCount)
  )
}
