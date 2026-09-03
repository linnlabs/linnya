/**
 * nodeId / domId 规范化工具（严格分层）
 *
 * 中文说明：
 * - 业务 nodeId：`nodeObj.id`，跨层接口唯一允许传递的节点标识
 * - DOM domId：`me${nodeId}`，仅用于 DOM 属性与交互层命中
 *
 * 目标：
 * - 避免 store key / IPC 入参 / 事件 payload 使用 domId（me 前缀）
 * - 避免散落的字符串拼接（`'me' + id`）导致不一致与难排查
 */

const DOM_NODE_ID_PREFIX = 'me'

function hasDomNodePrefix(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(DOM_NODE_ID_PREFIX)
}

function addDomNodePrefix(nodeId: string): string {
  return `${DOM_NODE_ID_PREFIX}${nodeId}`
}

function removeDomNodePrefix(domNodeId: string): string | null {
  if (!hasDomNodePrefix(domNodeId)) return null
  const nodeId = domNodeId.slice(DOM_NODE_ID_PREFIX.length)
  return nodeId ? nodeId : null
}

/**
 * 业务 nodeId -> DOM domId
 *
 * @param nodeId 业务节点 ID（来自 nodeObj.id）
 * @returns DOM 标识（data-nodeid 属性值）
 */
export function toDomNodeId(nodeId: string): string {
  return addDomNodePrefix(nodeId)
}

/**
 * DOM domId -> 业务 nodeId
 *
 * 中文说明：
 * - 用于交互入口（click/drag/contextmenu）命中 DOM 后第一时间转换
 * - 校验前缀并去掉，避免把其它字符串误当 nodeId
 *
 * @param domNodeId DOM 标识（data-nodeid 属性值）
 * @returns 业务节点 ID，若格式非法则返回 null
 */
export function fromDomNodeId(domNodeId: string): string | null {
  return removeDomNodePrefix(domNodeId)
}

/**
 * 类型守卫：判断某个值是否是合法 domId
 */
export function isDomNodeId(value: unknown): value is string {
  return hasDomNodePrefix(value)
}

/**
 * 类型断言：确保某个值是业务 nodeId（非空字符串）
 *
 * 中文说明：
 * - 用于跨层接口（store/IPC/event handler）硬校验
 * - 如果传入 null/undefined/空串/domId，直接抛错（fail fast）
 */
export function assertNodeId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`[nodeId] Invalid nodeId: ${String(value)}`)
  }
  if (hasDomNodePrefix(value)) {
    throw new Error(
      `[nodeId] domId (with '${DOM_NODE_ID_PREFIX}' prefix) is not allowed in cross-layer interface. Use fromDomNodeId() first.`
    )
  }
}

/**
 * 从 DOM 元素获取业务 nodeId
 *
 * 中文说明：
 * - 交互入口的快捷方式：命中 DOM 后直接拿业务 ID
 * - 内部会校验并转换 domId -> nodeId
 *
 * @param el DOM 元素（必须带 data-nodeid 属性）
 * @returns 业务 nodeId，若不存在或格式非法则返回 null
 */
export function getNodeIdFromDomElement(el: HTMLElement | null | undefined): string | null {
  if (!el) return null
  const domId = el.dataset?.nodeid
  if (!domId) return null
  return fromDomNodeId(domId)
}
