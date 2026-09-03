import { readRootBlockIdFromEventTarget } from '../../../shared/rootBlockDom';

/**
 * 从块级 chrome 事件目标向上读取 rootBlock id。
 *
 * 中文说明：Host 的 hover 来源只允许做一次事件委托下的 DOM 归属判定；
 * 不能把每块 NodeView 的 props 或业务状态带进来，否则中央化会重新耦合回旧路径。
 */
export function readRootBlockIdFromChromeEventTarget(target: EventTarget | null): string | null {
  return readRootBlockIdFromEventTarget(target);
}
