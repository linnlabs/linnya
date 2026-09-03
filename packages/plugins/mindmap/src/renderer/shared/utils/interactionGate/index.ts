/**
 * InteractionGate（交互门禁）模块导出
 *
 * 中文说明：
 * - 这是 MindMap 的交互基础设施，统一处理交互事件的过滤与路由
 * - 所有交互入口统一调用 Gate API，而不是各自判断 className/contentEditable
 */
export {
  // Data Attributes 标记
  InteractionMarkers,
  type InteractionMarker,
  // Gate API
  shouldIgnoreSelection,
  shouldIgnoreDrag,
  shouldIgnorePan,
  shouldIgnoreWheel,
  shouldIgnoreContextMenu,
  isInteractiveElement,
  // 类型
  type InteractionGateOptions,
  type GateContext,
  type WheelGateContext,
  // 便捷工具
  interactiveProps,
  ignoreSelectionProps,
  ignoreDragProps,
  ignorePanProps,
} from './InteractionGate'
