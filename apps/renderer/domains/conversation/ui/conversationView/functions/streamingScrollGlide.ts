/**
 * 流式跟随底部时的“视觉缓动”状态（纯函数，不依赖 DOM / Vue / 真实时钟）。
 *
 * 虚拟列表在尾行换行变高时会立刻把滚动位置补偿到底部，所以真实 scrollTop 是“一行一跳”。
 * scroll bridge 在真实滚动同次提交时发布增量，独立视觉层叠加反向位移并逐帧衰减。
 * 调用方必须隔离测量原点和滚动溢出范围，纯数值运算本身不保证 DOM 几何正确。
 */

/** 偏移衰减的时间常数（毫秒）：约 3 倍于它即基本落定。 */
export const SCROLL_GLIDE_TIME_CONSTANT_MS = 70;
/** 单次可被吸收的最大跳变（像素）。更大的跳变是结构性滚动（跳转、重排），直接放弃缓动。 */
export const SCROLL_GLIDE_MAX_ABSORBED_DELTA_PX = 120;
/** 偏移小于该值视为落定，直接归零。 */
export const SCROLL_GLIDE_SETTLE_PX = 0.3;
/** 单帧推进的最长时间（毫秒），避免页面被挂起后恢复时一次衰减到位。 */
export const SCROLL_GLIDE_MAX_FRAME_MS = 50;

/**
 * 一次真实滚动跳变（scrollTop 的变化量）进入缓动：
 * 内容整体沿滚动方向先“补回”这段位移，之后再滑动到位。
 */
export function absorbScrollDelta(offsetPx: number, deltaPx: number): number {
  if (deltaPx === 0 || !Number.isFinite(deltaPx)) return offsetPx;
  if (Math.abs(deltaPx) > SCROLL_GLIDE_MAX_ABSORBED_DELTA_PX) return 0;
  return offsetPx + deltaPx;
}

/** 把位移取整到设备像素，避免文字被亚像素重采样。 */
export function snapToDevicePixel(offsetPx: number, devicePixelRatio: number): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const snapped = Math.round(offsetPx * ratio) / ratio;
  return snapped === 0 ? 0 : snapped;
}

/** 偏移随时间指数衰减，落定后返回 0。 */
export function decayScrollGlideOffset(offsetPx: number, dtMs: number): number {
  if (offsetPx === 0) return 0;
  const dt = Math.min(Math.max(dtMs, 0), SCROLL_GLIDE_MAX_FRAME_MS);
  const next = offsetPx * Math.exp(-dt / SCROLL_GLIDE_TIME_CONSTANT_MS);
  return Math.abs(next) < SCROLL_GLIDE_SETTLE_PX ? 0 : next;
}
